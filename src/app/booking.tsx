/**
 * Passenger booking screen
 * Uses @supabase/supabase-js directly (same as jihwolrd) — no edge-function needed.
 * Colours / vehicles / statuses mirror jihwolrd exactly.
 */
import * as Location from 'expo-location';
import * as WebBrowser from 'expo-web-browser';
import { makeRedirectUri } from 'expo-auth-session';
import { useCallback, useEffect, useRef, useState } from 'react';

WebBrowser.maybeCompleteAuthSession();
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomTabInset, Spacing } from '@/constants/theme';
import { supabase } from '@/lib/supabase';

// ─── jihwolrd colour palette ──────────────────────────────────────────────────

const JIH = {
  navy:  '#111E2C', navyM: '#1B2A3B', navyL: '#253548', navyXL: '#2F4258',
  gold:  '#E8A020', goldL: '#F5B83A',
  white: '#FFFFFF',
  w70:   'rgba(255,255,255,0.70)', w55: 'rgba(255,255,255,0.55)',
  w30:   'rgba(255,255,255,0.30)', w15: 'rgba(255,255,255,0.15)',
  w10:   'rgba(255,255,255,0.10)',
} as const;

const SIEM_REAP = { latitude: 13.3671, longitude: 103.8498, latitudeDelta: 0.06, longitudeDelta: 0.06 };
const MAP_HEIGHT = 220;

// ─── Quick suggestions (mirrors jihwolrd LocationSearch.tsx) ─────────────────

type LocResult = { address: string; lat: number; lng: number };

const QUICK_SUGGESTIONS: (LocResult & { name: string })[] = [
  { name: 'Angkor Wat',             lat: 13.4125, lng: 103.8670, address: 'Angkor Wat, Siem Reap, Cambodia' },
  { name: 'Pub Street',             lat: 13.3533, lng: 103.8560, address: 'Pub Street, Siem Reap, Cambodia' },
  { name: 'Siem Reap Airport',      lat: 13.4117, lng: 103.8133, address: 'Siem Reap International Airport, Cambodia' },
  { name: 'Old Market (Psar Chas)', lat: 13.3531, lng: 103.8590, address: 'Old Market, Siem Reap, Cambodia' },
  { name: 'Angkor Night Market',    lat: 13.3585, lng: 103.8555, address: 'Angkor Night Market, Siem Reap, Cambodia' },
  { name: 'Royal Residence',        lat: 13.3620, lng: 103.8597, address: 'Royal Residence, Siem Reap, Cambodia' },
];

// ─── Nominatim reverse geocode ────────────────────────────────────────────────

const NOM = 'https://nominatim.openstreetmap.org';
const NOM_HDR = { 'User-Agent': 'JihWolrd-App/1.0', 'Accept-Language': 'en' };

async function searchPlaces(query: string): Promise<LocResult[]> {
  const res  = await fetch(`${NOM}/search?q=${encodeURIComponent(query)}&format=json&limit=6&countrycodes=kh`, { headers: NOM_HDR });
  const data = (await res.json()) as Array<{ display_name: string; lat: string; lon: string }>;
  return data.map(d => ({ address: d.display_name, lat: parseFloat(d.lat), lng: parseFloat(d.lon) }));
}

async function reverseGeocode(lat: number, lon: number): Promise<string> {
  const res  = await fetch(`${NOM}/reverse?lat=${lat}&lon=${lon}&format=json`, { headers: NOM_HDR });
  const data = (await res.json()) as { display_name?: string };
  return data.display_name ?? 'Current location';
}

// ─── Supabase API (direct SDK — RLS uses auth.uid()) ─────────────────────────

type Booking = {
  id: string; status: string; booking_type: string;
  pickup_address: string; destination_address: string | null;
  vehicle_type: string; ride_type: string; payment_method: string;
  estimated_fare: number | null; offered_fare: number | null;
  hire_description: string | null; scheduled_datetime: string | null;
  created_at: string; group_size: number; driver_name: string | null;
};

async function getUserId(): Promise<string> {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new Error('Not signed in');
  return user.id;
}

async function apiCreate(payload: Record<string, unknown>): Promise<Booking> {
  const userId = await getUserId();
  const { data, error } = await supabase.from('rides').insert({
    passenger_id: userId,
    payment_status: 'pending',
    ride_type: 'private',
    booking_type: 'standard',
    group_size: 1,
    ...payload,
  }).select().single();
  if (error) throw new Error(error.message);
  return data as Booking;
}

async function apiFetch(): Promise<Booking[]> {
  const userId = await getUserId();
  const { data, error } = await supabase
    .from('rides')
    .select('*')
    .eq('passenger_id', userId)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);
  return (data ?? []) as Booking[];
}

async function apiCancel(id: string): Promise<void> {
  const { error } = await supabase
    .from('rides')
    .update({ status: 'cancelled', cancelled_at: new Date().toISOString(), cancellation_reason: 'Cancelled by passenger via app' })
    .eq('id', id)
    .in('status', ['pending', 'scheduled']);
  if (error) throw new Error(error.message);
}

// ─── Vehicles (mirrors VehicleSelector.tsx) ───────────────────────────────────

const VEHICLES = [
  { type: 'tuktuk', icon: '🛺', label: 'Tuk Tuk', desc: 'Classic Cambodia', baseFare: 1.0, perKm: 0.4, maxSeats: 4 },
  { type: 'car',    icon: '🚗', label: 'Car',     desc: 'Comfortable & AC', baseFare: 1.5, perKm: 0.6, maxSeats: 5 },
  { type: 'moto',   icon: '🏍️',label: 'Moto',    desc: 'Fast & affordable',baseFare: 0.75,perKm: 0.3, maxSeats: 1 },
  { type: 'van',    icon: '🚐', label: 'Van',     desc: 'Groups up to 8',  baseFare: 2.0, perKm: 0.8, maxSeats: 8 },
] as const;
type VehicleType = (typeof VEHICLES)[number]['type'];

// ─── Payments (mirrors PaymentSelection.tsx) ──────────────────────────────────

const PAYMENTS = [
  { id: 'cash', icon: '💵', label: 'Cash',  desc: 'Pay driver after ride' },
  { id: 'card', icon: '💳', label: 'Card',  desc: 'Demo only' },
  { id: 'aba',  icon: '🏦', label: 'ABA',   desc: 'Transfer via ABA Bank' },
  { id: 'wing', icon: '📱', label: 'Wing',  desc: 'Send via Wing transfer' },
] as const;
type PaymentId = (typeof PAYMENTS)[number]['id'];

// ─── Status pills (mirrors HistoryTab.tsx STATUS_PILL) ────────────────────────

const STATUS_PILL: Record<string, { label: string; bg: string; color: string }> = {
  pending:     { label: 'Looking for driver', bg: '#F3F4F6', color: '#6B7280' },
  matched:     { label: 'Driver on the way',  bg: '#F3E8FF', color: '#7C3AED' },
  arrived:     { label: 'Driver arrived',     bg: '#FEF3C7', color: '#92400E' },
  in_progress: { label: 'Ride in progress',   bg: '#DBEAFE', color: '#1D4ED8' },
  completed:   { label: 'Completed',          bg: '#D1FAE5', color: '#065F46' },
  cancelled:   { label: 'Cancelled',          bg: '#FEE2E2', color: '#991B1B' },
  scheduled:   { label: 'Scheduled',          bg: '#F5F5F4', color: '#44403C' },
};

// ─── Booking modes ─────────────────────────────────────────────────────────────

type BookingMode = 'standard' | 'scheduled' | 'full_day';
const MODES: { id: BookingMode; label: string }[] = [
  { id: 'standard',  label: 'Standard'  },
  { id: 'scheduled', label: 'Scheduled' },
  { id: 'full_day',  label: 'Full Day'  },
];

function makePresets() {
  const now = new Date();
  const add = (h: number) => { const d = new Date(now); d.setHours(d.getHours() + h, 0, 0, 0); return d.toISOString(); };
  const tmr = (h: number) => { const d = new Date(now); d.setDate(d.getDate() + 1); d.setHours(h, 0, 0, 0); return d.toISOString(); };
  return [
    { label: 'In 1 hour',     iso: add(1) },
    { label: 'In 2 hours',    iso: add(2) },
    { label: 'Tomorrow 8 am', iso: tmr(8) },
    { label: 'Tomorrow 2 pm', iso: tmr(14) },
  ];
}

// ─── Shared small components ──────────────────────────────────────────────────

function StatusPill({ status }: { status: string }) {
  const c = STATUS_PILL[status] ?? STATUS_PILL.pending;
  return <View style={[ss.pill, { backgroundColor: c.bg }]}><Text style={[ss.pillTxt, { color: c.color }]}>{c.label}</Text></View>;
}

function GoldTabs({ tabs, active, onPress }: { tabs: { id: string; label: string }[]; active: string; onPress: (id: string) => void }) {
  return (
    <View style={ss.modebar}>
      {tabs.map(t => (
        <Pressable key={t.id} style={ss.modeBtn} onPress={() => onPress(t.id)}>
          <Text style={[ss.modeTxt, active === t.id ? ss.modeTxtOn : ss.modeTxtOff]}>{t.label}</Text>
          {active === t.id && <View style={ss.modeUnder} />}
        </Pressable>
      ))}
    </View>
  );
}

// ─── Cambodian phone utils (mirrors jihwolrd src/lib/phone.ts) ───────────────

const sanitizeKhDigits = (raw: string) => {
  const d = (raw ?? '').replace(/\D/g, '');
  return d.startsWith('0') ? d.slice(1) : d;
};
const formatKhMask = (digits: string) => {
  const d = sanitizeKhDigits(digits);
  if (d.length <= 2) return d;
  if (d.length <= 5) return `${d.slice(0, 2)} ${d.slice(2)}`;
  return `${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5, 12)}`;
};
const composeKhPhone = (digits: string) => {
  const d = sanitizeKhDigits(digits);
  return d ? `+855${d}` : '';
};
const isValidKhPhone = (digits: string) => {
  const d = sanitizeKhDigits(digits);
  return d.length >= 8 && d.length <= 9;
};

// ─── Password strength (mirrors jihwolrd Auth.tsx) ────────────────────────────

const getPwStrength = (pw: string) => {
  let s = 0;
  if (pw.length >= 8) s++;
  if (/[A-Z]/.test(pw)) s++;
  if (/[0-9]/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  return s;
};
const STRENGTH_LABEL = ['Very weak', 'Weak', 'Fair', 'Strong'];
const STRENGTH_COLOR = ['#EF4444', '#F97316', '#EAB308', '#22C55E'];

// ─── PasswordInput — input + show/hide toggle ─────────────────────────────────

function PasswordInput({
  placeholder, value, onChangeText, returnKeyType, onSubmitEditing, inputRef,
}: {
  placeholder: string; value: string; onChangeText: (v: string) => void;
  returnKeyType?: 'next' | 'done'; onSubmitEditing?: () => void;
  inputRef?: React.RefObject<TextInput | null>;
}) {
  const [show, setShow] = useState(false);
  return (
    <View style={ss.pwdRow}>
      <TextInput
        ref={inputRef}
        style={ss.pwdInput}
        placeholder={placeholder}
        placeholderTextColor={JIH.w30}
        value={value}
        onChangeText={onChangeText}
        secureTextEntry={!show}
        autoCapitalize="none"
        returnKeyType={returnKeyType ?? 'done'}
        onSubmitEditing={onSubmitEditing}
      />
      <Pressable onPress={() => setShow(v => !v)} style={ss.pwdEye} hitSlop={8}>
        <Text style={ss.pwdEyeTxt}>{show ? '🙈' : '👁️'}</Text>
      </Pressable>
    </View>
  );
}

// ─── Sign-In / Sign-Up Screen (matches jihwolrd Auth.tsx) ─────────────────────

type AuthTab = 'login' | 'signup';

function SignInScreen({ onSignedIn }: { onSignedIn: () => void }) {
  const [tab,            setTab]           = useState<AuthTab>('signup');
  const [loading,        setLoading]       = useState(false);
  const [googleLoading,  setGoogleLoading] = useState(false);
  const [appleLoading,   setAppleLoading]  = useState(false);
  const [verifyEmail,    setVerifyEmail]   = useState('');   // non-empty → show verify screen

  // Login form
  const [loginEmail, setLoginEmail]   = useState('');
  const [loginPwd,   setLoginPwd]     = useState('');

  // Signup form
  const [fullName,   setFullName]     = useState('');
  const [signEmail,  setSignEmail]    = useState('');
  const [phone,      setPhone]        = useState('');       // local digits only
  const [pwd,        setPwd]          = useState('');
  const [confirmPwd, setConfirmPwd]   = useState('');
  const [agreed,     setAgreed]       = useState(false);

  const pwStrength = getPwStrength(pwd);

  // Refs for tab-order
  const loginPwdRef   = useRef<TextInput>(null);
  const emailRef      = useRef<TextInput>(null);
  const phoneRef      = useRef<TextInput>(null);
  const pwdRef        = useRef<TextInput>(null);
  const confirmPwdRef = useRef<TextInput>(null);

  // ── OAuth helper ──────────────────────────────────────────────────────────

  const handleOAuth = async (provider: 'google' | 'apple', setProviderLoading: (v: boolean) => void) => {
    setProviderLoading(true);
    try {
      const redirectTo = makeRedirectUri({ scheme: 'myapp', path: 'auth/callback' });
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo, skipBrowserRedirect: true },
      });
      if (error) throw error;
      if (!data.url) throw new Error('No OAuth URL returned');
      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
      if (result.type === 'success' && result.url) {
        const fragment = result.url.split('#')[1] ?? result.url.split('?')[1] ?? '';
        const params   = Object.fromEntries(new URLSearchParams(fragment));
        if (params.access_token) {
          const { error: sessErr } = await supabase.auth.setSession({
            access_token:  params.access_token,
            refresh_token: params.refresh_token ?? '',
          });
          if (sessErr) throw sessErr;
          const { data: { user } } = await supabase.auth.getUser();
          if (user) {
            const { data: existingRole } = await supabase.from('user_roles').select('role').eq('user_id', user.id).maybeSingle();
            if (!existingRole) {
              await supabase.from('user_roles').insert({ user_id: user.id, role: 'passenger' });
            }
            onSignedIn();
          }
        }
      }
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : `${provider} sign in failed`);
    } finally { setProviderLoading(false); }
  };

  // ── Login ─────────────────────────────────────────────────────────────────

  const handleLogin = async () => {
    if (!loginEmail.trim() || !loginPwd.trim()) { Alert.alert('Required', 'Enter your email and password.'); return; }
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: loginEmail.trim(), password: loginPwd });
      if (error) throw error;
      const { data: { user } } = await supabase.auth.getUser();
      if (user && !user.email_confirmed_at) { setVerifyEmail(loginEmail.trim()); return; }
      onSignedIn();
    } catch (e) { Alert.alert('Error', e instanceof Error ? e.message : 'Login failed'); }
    finally { setLoading(false); }
  };

  // ── Sign Up ───────────────────────────────────────────────────────────────

  const handleSignUp = async () => {
    if (!fullName.trim())  { Alert.alert('Required', 'Please enter your full name.'); return; }
    if (!signEmail.trim()) { Alert.alert('Required', 'Please enter your email.'); return; }
    if (pwd.length < 8)    { Alert.alert('Password too short', 'Password must be at least 8 characters.'); return; }
    if (pwd !== confirmPwd){ Alert.alert('Mismatch', 'Passwords do not match.'); return; }
    if (phone && !isValidKhPhone(phone)) { Alert.alert('Invalid phone', 'Please enter a valid Cambodian phone number (+855 XX XXX XXXX).'); return; }
    if (!agreed) { Alert.alert('Terms required', 'Please agree to the Terms of Service.'); return; }

    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email: signEmail.trim(),
        password: pwd,
        options: { data: { full_name: fullName.trim(), role: 'passenger' } },
      });
      if (error) throw error;
      if (data.user) {
        if (phone) {
          await supabase.from('profiles').update({ phone: composeKhPhone(phone) }).eq('id', data.user.id);
        }
        if (data.user.email_confirmed_at || data.session) {
          onSignedIn();
        } else {
          setVerifyEmail(signEmail.trim());
        }
      }
    } catch (e) { Alert.alert('Error', e instanceof Error ? e.message : 'Sign up failed'); }
    finally { setLoading(false); }
  };

  // ── Resend verification email ─────────────────────────────────────────────

  const handleResend = async () => {
    setLoading(true);
    try {
      const { error } = await supabase.auth.resend({ type: 'signup', email: verifyEmail });
      if (error) throw error;
      Alert.alert('Sent', 'Verification email resent!');
    } catch (e) { Alert.alert('Error', e instanceof Error ? e.message : 'Failed to resend'); }
    finally { setLoading(false); }
  };

  // ── Verify-email screen ───────────────────────────────────────────────────

  if (verifyEmail) {
    return (
      <KeyboardAvoidingView style={ss.authScreen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={[ss.authScroll, { justifyContent: 'center' }]} keyboardShouldPersistTaps="handled">
          <View style={ss.authLogo}>
            <Text style={{ fontSize: 56 }}>✉️</Text>
            <Text style={ss.authTitle}>Almost there!</Text>
            <Text style={[ss.authSub, { textAlign: 'center' }]}>
              We sent a verification link to{'\n'}<Text style={{ color: JIH.gold }}>{verifyEmail}</Text>
              {'\n'}Click the link to activate your account.
            </Text>
          </View>
          <Pressable onPress={handleResend} disabled={loading}
            style={({ pressed }) => [ss.authBtnOutline, { opacity: pressed || loading ? 0.7 : 1 }]}>
            {loading ? <ActivityIndicator color={JIH.gold} /> : <Text style={ss.authBtnOutlineTxt}>Resend Email</Text>}
          </Pressable>
          <Pressable onPress={() => { setVerifyEmail(''); setTab('login'); }} style={ss.authSwitch}>
            <Text style={ss.authSwitchTxt}>← Back to Log In</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // ── Main auth screen ──────────────────────────────────────────────────────

  return (
    <KeyboardAvoidingView style={ss.authScreen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={ss.authScroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

        {/* Logo */}
        <View style={ss.authLogo}>
          <Text style={ss.authEmoji}>🛺</Text>
          <Text style={ss.authTitle}>JihWolrd Rides</Text>
          <Text style={ss.authSub}>Passenger Account</Text>
        </View>

        {/* Google OAuth */}
        <Pressable onPress={() => handleOAuth('google', setGoogleLoading)} disabled={googleLoading || loading}
          style={({ pressed }) => [ss.oauthBtn, { opacity: pressed || googleLoading ? 0.7 : 1 }]}>
          {googleLoading ? <ActivityIndicator color={JIH.white} size="small" /> : (
            <>
              <Text style={ss.oauthIcon}>G</Text>
              <Text style={ss.oauthTxt}>Continue with Google</Text>
            </>
          )}
        </Pressable>

        {/* Apple OAuth */}
        <Pressable onPress={() => handleOAuth('apple', setAppleLoading)} disabled={appleLoading || loading}
          style={({ pressed }) => [ss.oauthBtn, ss.oauthBtnApple, { opacity: pressed || appleLoading ? 0.7 : 1 }]}>
          {appleLoading ? <ActivityIndicator color={JIH.navy} size="small" /> : (
            <>
              <Text style={[ss.oauthIcon, ss.oauthIconApple]}>🍎</Text>
              <Text style={[ss.oauthTxt, ss.oauthTxtApple]}>Continue with Apple</Text>
            </>
          )}
        </Pressable>

        {/* OR divider */}
        <View style={ss.orRow}>
          <View style={ss.orLine} />
          <Text style={ss.orTxt}>or continue with email</Text>
          <View style={ss.orLine} />
        </View>

        {/* Tab switcher: Sign Up | Log In */}
        <View style={ss.authTabBar}>
          {(['signup', 'login'] as AuthTab[]).map(t => (
            <Pressable key={t} style={ss.authTab} onPress={() => setTab(t)}>
              <Text style={[ss.authTabTxt, tab === t ? ss.authTabOn : ss.authTabOff]}>
                {t === 'signup' ? 'Sign Up' : 'Log In'}
              </Text>
              {tab === t && <View style={ss.authTabUnder} />}
            </Pressable>
          ))}
        </View>

        {/* ── LOG IN ── */}
        {tab === 'login' && (
          <View style={ss.formGroup}>
            <Text style={ss.authLabel}>Email</Text>
            <TextInput style={ss.authInput} placeholder="you@example.com" placeholderTextColor={JIH.w30}
              value={loginEmail} onChangeText={setLoginEmail} keyboardType="email-address"
              autoCapitalize="none" returnKeyType="next" onSubmitEditing={() => loginPwdRef.current?.focus()} />

            <Text style={[ss.authLabel, { marginTop: Spacing.two }]}>Password</Text>
            <PasswordInput placeholder="Password" value={loginPwd} onChangeText={setLoginPwd}
              returnKeyType="done" onSubmitEditing={handleLogin} inputRef={loginPwdRef} />

            <Pressable onPress={handleLogin} disabled={loading}
              style={({ pressed }) => [ss.authBtn, { marginTop: Spacing.three, opacity: pressed || loading ? 0.8 : 1 }]}>
              {loading ? <ActivityIndicator color={JIH.navy} /> : <Text style={ss.authBtnTxt}>Log In</Text>}
            </Pressable>

            <Pressable style={ss.authSwitch} onPress={() => Alert.alert('Forgot Password', 'Visit jihwithme.com to reset your password.')}>
              <Text style={ss.authSwitchTxt}>Forgot password?</Text>
            </Pressable>
            <View style={ss.authSwitchRow}>
              <Text style={ss.authSwitchMuted}>Don't have an account? </Text>
              <Pressable onPress={() => setTab('signup')}><Text style={ss.authSwitchTxt}>Sign Up</Text></Pressable>
            </View>
          </View>
        )}

        {/* ── SIGN UP ── */}
        {tab === 'signup' && (
          <View style={ss.formGroup}>
            {/* Full Name */}
            <Text style={ss.authLabel}>Full Name</Text>
            <TextInput style={ss.authInput} placeholder="Your full name" placeholderTextColor={JIH.w30}
              value={fullName} onChangeText={setFullName} autoCapitalize="words"
              returnKeyType="next" onSubmitEditing={() => emailRef.current?.focus()} />

            {/* Email */}
            <Text style={[ss.authLabel, { marginTop: Spacing.two }]}>Email</Text>
            <TextInput ref={emailRef} style={ss.authInput} placeholder="you@example.com" placeholderTextColor={JIH.w30}
              value={signEmail} onChangeText={setSignEmail} keyboardType="email-address"
              autoCapitalize="none" returnKeyType="next" onSubmitEditing={() => phoneRef.current?.focus()} />

            {/* Phone (+855) */}
            <Text style={[ss.authLabel, { marginTop: Spacing.two }]}>Phone (optional)</Text>
            <View style={ss.phoneRow}>
              <View style={ss.phonePrefix}><Text style={ss.phonePrefixTxt}>+855</Text></View>
              <TextInput ref={phoneRef} style={ss.phoneInput} placeholder="XX XXX XXXX"
                placeholderTextColor={JIH.w30} value={formatKhMask(phone)}
                onChangeText={v => setPhone(sanitizeKhDigits(v))}
                keyboardType="phone-pad" maxLength={12}
                returnKeyType="next" onSubmitEditing={() => pwdRef.current?.focus()} />
            </View>
            {phone.length > 0 && !isValidKhPhone(phone) && (
              <Text style={ss.fieldError}>Please enter a valid Cambodian phone number</Text>
            )}

            {/* Password */}
            <Text style={[ss.authLabel, { marginTop: Spacing.two }]}>Password</Text>
            <PasswordInput placeholder="Min. 8 characters" value={pwd} onChangeText={setPwd}
              returnKeyType="next" onSubmitEditing={() => confirmPwdRef.current?.focus()} inputRef={pwdRef} />
            {pwd.length > 0 && (
              <View style={ss.strengthWrap}>
                <View style={ss.strengthBar}>
                  {[0,1,2,3].map(i => (
                    <View key={i} style={[ss.strengthSeg, { backgroundColor: i < pwStrength ? STRENGTH_COLOR[pwStrength - 1] : JIH.navyL }]} />
                  ))}
                </View>
                <Text style={[ss.strengthLbl, { color: STRENGTH_COLOR[Math.max(0, pwStrength - 1)] }]}>
                  {STRENGTH_LABEL[pwStrength] ?? ''}
                </Text>
              </View>
            )}

            {/* Confirm Password */}
            <Text style={[ss.authLabel, { marginTop: Spacing.two }]}>Confirm Password</Text>
            <PasswordInput placeholder="Re-enter password" value={confirmPwd} onChangeText={setConfirmPwd}
              returnKeyType="done" inputRef={confirmPwdRef} />
            {confirmPwd.length > 0 && pwd !== confirmPwd && (
              <Text style={ss.fieldError}>Passwords do not match</Text>
            )}

            {/* Terms checkbox */}
            <Pressable onPress={() => setAgreed(v => !v)} style={ss.termsRow}>
              <View style={[ss.checkbox, agreed && ss.checkboxOn]}>
                {agreed && <Text style={ss.checkmark}>✓</Text>}
              </View>
              <Text style={ss.termsTxt}>
                I agree to the{' '}
                <Text style={ss.termsLink} onPress={() => Alert.alert('Terms', 'Visit jihwithme.com/terms')}>Terms of Service</Text>
                {' '}and{' '}
                <Text style={ss.termsLink} onPress={() => Alert.alert('Privacy', 'Visit jihwithme.com/privacy')}>Privacy Policy</Text>
              </Text>
            </Pressable>

            <Pressable onPress={handleSignUp} disabled={loading || !agreed}
              style={({ pressed }) => [ss.authBtn, { marginTop: Spacing.two, opacity: (pressed || loading || !agreed) ? 0.6 : 1 }]}>
              {loading ? <ActivityIndicator color={JIH.navy} /> : <Text style={ss.authBtnTxt}>Create Account</Text>}
            </Pressable>

            <View style={ss.authSwitchRow}>
              <Text style={ss.authSwitchMuted}>Already have an account? </Text>
              <Pressable onPress={() => setTab('login')}><Text style={ss.authSwitchTxt}>Log In</Text></Pressable>
            </View>
          </View>
        )}

      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ─── Location input card ──────────────────────────────────────────────────────

type FieldType = 'pickup' | 'dest';

function LocationInputCard({
  pickupText, destText, onPickupChange, onDestChange,
  onPickupFocus, onDestFocus, onClearPickup, onClearDest,
  onGps, gpsLoading, mode,
}: {
  pickupText: string; destText: string;
  onPickupChange: (v: string) => void; onDestChange: (v: string) => void;
  onPickupFocus: () => void; onDestFocus: () => void;
  onClearPickup: () => void; onClearDest: () => void;
  onGps: () => void; gpsLoading: boolean; mode: BookingMode;
}) {
  const destRef = useRef<TextInput>(null);
  return (
    <View style={ss.locCard}>
      <View style={ss.locRow}>
        <View style={[ss.dot, ss.dotG]} />
        <TextInput style={ss.locInput} placeholder="Pickup location" placeholderTextColor={JIH.w30}
          value={pickupText} onChangeText={onPickupChange} onFocus={onPickupFocus}
          returnKeyType={mode !== 'full_day' ? 'next' : 'done'}
          onSubmitEditing={() => destRef.current?.focus()} />
        {gpsLoading
          ? <ActivityIndicator size="small" color={JIH.gold} style={{ marginRight: 4 }} />
          : <Pressable onPress={onGps} style={ss.iconBtn} hitSlop={8}><Text style={ss.iconBtnTxt}>📍</Text></Pressable>}
        {pickupText.length > 0 && <Pressable onPress={onClearPickup} style={ss.iconBtn} hitSlop={8}><Text style={ss.clearTxt}>✕</Text></Pressable>}
      </View>
      {mode !== 'full_day' && (
        <>
          <View style={ss.locDivider} />
          <View style={ss.locRow}>
            <View style={[ss.dot, ss.dotR]} />
            <TextInput ref={destRef} style={ss.locInput} placeholder="Where to?" placeholderTextColor={JIH.w30}
              value={destText} onChangeText={onDestChange} onFocus={onDestFocus} returnKeyType="done" />
            {destText.length > 0 && <Pressable onPress={onClearDest} style={ss.iconBtn} hitSlop={8}><Text style={ss.clearTxt}>✕</Text></Pressable>}
          </View>
        </>
      )}
    </View>
  );
}

// ─── Suggestions list ─────────────────────────────────────────────────────────

function SuggestionsList({ query, activeField, onSelect, onGps }: {
  query: string; activeField: FieldType | null;
  onSelect: (loc: LocResult) => void; onGps: () => void;
}) {
  const [items,   setItems]   = useState<LocResult[]>([]);
  const [loading, setLoading] = useState(false);
  const debRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!activeField || query.length < 2) { setItems([]); return; }
    if (debRef.current) clearTimeout(debRef.current);
    setLoading(true);
    debRef.current = setTimeout(async () => {
      try { setItems(await searchPlaces(query)); }
      catch { setItems([]); }
      finally { setLoading(false); }
    }, 300);
    return () => { if (debRef.current) clearTimeout(debRef.current); };
  }, [query, activeField]);

  if (!activeField) return null;

  if (query.length < 2) {
    return (
      <View style={ss.suggBox}>
        {activeField === 'pickup' && (
          <Pressable style={ss.suggGps} onPress={onGps}>
            <Text style={ss.suggGpsIcon}>🎯</Text>
            <Text style={ss.suggGpsLbl}>Use current location</Text>
          </Pressable>
        )}
        <View style={ss.suggSect}><Text style={ss.suggSectLbl}>Popular places</Text></View>
        {QUICK_SUGGESTIONS.map((p, i) => (
          <Pressable key={i} style={ss.suggRow} onPress={() => onSelect(p)}>
            <Text style={ss.suggPin}>📍</Text>
            <View style={ss.suggInfo}>
              <Text style={ss.suggName}>{p.name}</Text>
              <Text style={ss.suggAddr} numberOfLines={1}>{p.address}</Text>
            </View>
          </Pressable>
        ))}
      </View>
    );
  }

  if (loading) return (
    <View style={[ss.suggBox, ss.suggLoadRow]}>
      <ActivityIndicator color={JIH.gold} size="small" />
      <Text style={ss.suggLoadTxt}>Searching…</Text>
    </View>
  );

  if (!items.length) return null;

  return (
    <View style={ss.suggBox}>
      {items.map((item, i) => (
        <Pressable key={i} style={ss.suggRow} onPress={() => onSelect(item)}>
          <Text style={ss.suggPin}>📍</Text>
          <Text style={ss.suggAddr} numberOfLines={2}>{item.address}</Text>
        </Pressable>
      ))}
    </View>
  );
}

// ─── VehicleCard ──────────────────────────────────────────────────────────────

function VehicleCard({ v, selected, onPress }: { v: (typeof VEHICLES)[number]; selected: boolean; onPress: () => void }) {
  const scale = useSharedValue(1);
  return (
    <Animated.View style={useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }))}>
      <Pressable onPressIn={() => { scale.value = withSpring(0.93); }} onPressOut={() => { scale.value = withSpring(1); }}
        onPress={onPress} style={[ss.vCard, selected && ss.vCardOn]}>
        <Text style={ss.vIcon}>{v.icon}</Text>
        <Text style={[ss.vLabel, selected && ss.vLabelOn]}>{v.label}</Text>
        <Text style={ss.vDesc}>{v.desc}</Text>
        <Text style={[ss.vFare, selected && ss.vFareOn]}>From ${v.baseFare.toFixed(2)}</Text>
        <Text style={ss.vSeats}>{v.maxSeats} seats</Text>
      </Pressable>
    </Animated.View>
  );
}

// ─── PaymentOption ────────────────────────────────────────────────────────────

function PaymentOption({ p, selected, onPress }: { p: (typeof PAYMENTS)[number]; selected: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[ss.pmOpt, selected && ss.pmOptOn]}>
      <Text style={ss.pmIcon}>{p.icon}</Text>
      <View style={ss.pmInfo}>
        <Text style={[ss.pmLabel, selected && ss.pmLabelOn]}>{p.label}</Text>
        <Text style={ss.pmDesc}>{p.desc}</Text>
      </View>
      <View style={[ss.radio, selected && ss.radioOn]}>
        {selected && <View style={ss.radioDot} />}
      </View>
    </Pressable>
  );
}

// ─── RideCard ────────────────────────────────────────────────────────────────

function RideCard({ ride, onCancel }: { ride: Booking; onCancel: (id: string) => void }) {
  const canCancel = ride.status === 'pending' || ride.status === 'scheduled';
  const vehicle   = VEHICLES.find(v => v.type === ride.vehicle_type);
  const fareStr   = ride.offered_fare ? `$${ride.offered_fare.toFixed(2)}` : ride.estimated_fare ? `$${ride.estimated_fare.toFixed(2)}` : `From $${(vehicle?.baseFare ?? 1).toFixed(2)}`;
  const dateStr   = ride.scheduled_datetime ? `Scheduled: ${new Date(ride.scheduled_datetime).toLocaleString()}` : new Date(ride.created_at).toLocaleString();
  const scale     = useSharedValue(1);
  return (
    <Animated.View style={[useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] })), ss.rideCard]}>
      <View style={ss.rideHdr}><StatusPill status={ride.status} /><Text style={ss.rideDate}>{dateStr}</Text></View>
      <View style={ss.routeRow}>
        <View style={ss.routeDots}>
          <View style={[ss.rdot, ss.rdotG]} /><View style={ss.rline} /><View style={[ss.rdot, ss.rdotR]} />
        </View>
        <View style={ss.routeAddrs}>
          <Text style={ss.addrPrimary} numberOfLines={1}>{ride.pickup_address}</Text>
          <Text style={ss.addrSec} numberOfLines={1}>{ride.destination_address ?? (ride.hire_description ? `Full Day: ${ride.hire_description}` : '—')}</Text>
        </View>
      </View>
      <View style={ss.rideFooter}>
        <View style={ss.chips}>
          {[`${vehicle?.icon ?? '🚗'} ${vehicle?.label ?? ride.vehicle_type}`, fareStr, `${PAYMENTS.find(p => p.id === ride.payment_method)?.icon ?? '💵'} ${ride.payment_method}`, ...(ride.driver_name ? [`👤 ${ride.driver_name}`] : [])].map((t, i) => (
            <View key={i} style={ss.chip}><Text style={ss.chipTxt}>{t}</Text></View>
          ))}
        </View>
        {canCancel && (
          <Pressable onPressIn={() => { scale.value = withSpring(0.95); }} onPressOut={() => { scale.value = withSpring(1); }}
            onPress={() => Alert.alert('Cancel Ride', 'Are you sure?', [
              { text: 'No', style: 'cancel' },
              { text: 'Yes, Cancel', style: 'destructive', onPress: () => onCancel(ride.id) },
            ])} style={ss.cancelBtn}>
            <Text style={ss.cancelTxt}>Cancel Ride</Text>
          </Pressable>
        )}
      </View>
    </Animated.View>
  );
}

// ─── BookForm ─────────────────────────────────────────────────────────────────

function BookForm({ onBooked }: { onBooked: () => void }) {
  const [mode,        setMode]        = useState<BookingMode>('standard');
  const [pickupLoc,   setPickupLoc]   = useState<LocResult | null>(null);
  const [destLoc,     setDestLoc]     = useState<LocResult | null>(null);
  const [pickupText,  setPickupText]  = useState('');
  const [destText,    setDestText]    = useState('');
  const [activeField, setActiveField] = useState<FieldType | null>(null);
  const [vehicle,     setVehicle]     = useState<VehicleType>('tuktuk');
  const [payment,     setPayment]     = useState<PaymentId>('cash');
  const [groupSize,   setGroupSize]   = useState(1);
  const [schedPreset, setSchedPreset] = useState('');
  const [hireDesc,    setHireDesc]    = useState('');
  const [offeredFare, setOfferedFare] = useState('');
  const [gpsLoading,  setGpsLoading]  = useState(false);
  const [loading,     setLoading]     = useState(false);
  const mapRef = useRef<MapView>(null);
  const presets = makePresets();
  const selV = VEHICLES.find(v => v.type === vehicle)!;

  useEffect(() => {
    if (pickupLoc && destLoc) {
      mapRef.current?.fitToCoordinates(
        [{ latitude: pickupLoc.lat, longitude: pickupLoc.lng }, { latitude: destLoc.lat, longitude: destLoc.lng }],
        { edgePadding: { top: 40, right: 40, bottom: 40, left: 40 }, animated: true },
      );
    } else if (pickupLoc) {
      mapRef.current?.animateToRegion({ latitude: pickupLoc.lat, longitude: pickupLoc.lng, latitudeDelta: 0.03, longitudeDelta: 0.03 }, 400);
    }
  }, [pickupLoc, destLoc]);

  const handleGps = useCallback(async () => {
    setGpsLoading(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') { Alert.alert('Denied', 'Enable location access in Settings.'); return; }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const address = await reverseGeocode(pos.coords.latitude, pos.coords.longitude);
      const loc: LocResult = { lat: pos.coords.latitude, lng: pos.coords.longitude, address };
      setPickupLoc(loc); setPickupText(address); setActiveField(null);
    } catch { Alert.alert('Error', 'Could not get your location.'); }
    finally { setGpsLoading(false); }
  }, []);

  const handleMapPress = useCallback(async (e: { nativeEvent: { coordinate: { latitude: number; longitude: number } } }) => {
    const { latitude, longitude } = e.nativeEvent.coordinate;
    const address = await reverseGeocode(latitude, longitude);
    const loc: LocResult = { lat: latitude, lng: longitude, address };
    if (!pickupLoc || activeField === 'pickup') {
      setPickupLoc(loc); setPickupText(address); setActiveField(null);
    } else {
      setDestLoc(loc); setDestText(address); setActiveField(null);
    }
  }, [pickupLoc, activeField]);

  const handleSelect = useCallback((loc: LocResult) => {
    if (activeField === 'pickup') { setPickupLoc(loc); setPickupText(loc.address); }
    else { setDestLoc(loc); setDestText(loc.address); }
    setActiveField(null);
  }, [activeField]);

  const handleBook = useCallback(async () => {
    if (!pickupText.trim()) { Alert.alert('Missing', 'Please enter a pickup location.'); return; }
    if (mode !== 'full_day' && !destText.trim()) { Alert.alert('Missing', 'Please enter a destination.'); return; }
    if (mode === 'scheduled' && !schedPreset) { Alert.alert('Missing', 'Please choose a time.'); return; }
    if (mode === 'full_day' && !offeredFare.trim()) { Alert.alert('Missing', 'Please enter your offered price.'); return; }
    setLoading(true);
    try {
      await apiCreate({
        pickup_address:      pickupText.trim(),
        pickup_lat:          pickupLoc?.lat ?? null,
        pickup_lng:          pickupLoc?.lng ?? null,
        destination_address: mode !== 'full_day' ? destText.trim() : null,
        destination_lat:     destLoc?.lat ?? null,
        destination_lng:     destLoc?.lng ?? null,
        vehicle_type:        vehicle,
        booking_type:        mode === 'full_day' ? 'full_day' : 'standard',
        status:              mode === 'scheduled' ? 'scheduled' : 'pending',
        group_size:          groupSize,
        payment_method:      payment,
        estimated_fare:      mode !== 'full_day' ? selV.baseFare : null,
        offered_fare:        mode === 'full_day' ? parseFloat(offeredFare) : null,
        hire_description:    mode === 'full_day' ? (hireDesc.trim() || null) : null,
        scheduled_datetime:  mode === 'scheduled' ? schedPreset : null,
      });
      setPickupText(''); setDestText(''); setPickupLoc(null); setDestLoc(null);
      setHireDesc(''); setOfferedFare(''); setSchedPreset('');
      Alert.alert(
        mode === 'full_day' ? '✅ Full Day Requested' : mode === 'scheduled' ? '✅ Ride Scheduled' : '✅ Ride Requested',
        mode === 'full_day' ? 'Your full-day offer was submitted.' :
        mode === 'scheduled' ? "Your ride is scheduled. We'll find a driver when the time comes." :
        'Looking for a driver for you…',
      );
      onBooked();
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Something went wrong.');
    } finally { setLoading(false); }
  }, [pickupText, destText, pickupLoc, destLoc, vehicle, payment, groupSize, schedPreset, hireDesc, offeredFare, mode, selV, onBooked]);

  const activeQuery = activeField === 'pickup' ? pickupText : destText;
  const bookLabel   = loading ? 'Booking…' : mode === 'full_day' ? 'Submit Full Day Offer →' : `Book ${selV.label} · $${selV.baseFare.toFixed(2)}+ →`;

  return (
    <View style={{ flex: 1 }}>
      <MapView ref={mapRef} style={ss.map} initialRegion={SIEM_REAP}
        onPress={handleMapPress} showsUserLocation showsMyLocationButton={false}>
        {pickupLoc && <Marker coordinate={{ latitude: pickupLoc.lat, longitude: pickupLoc.lng }} title="Pickup" pinColor="#22C55E" />}
        {destLoc   && <Marker coordinate={{ latitude: destLoc.lat,   longitude: destLoc.lng   }} title="Destination" pinColor="#EF4444" />}
        {pickupLoc && destLoc && (
          <Polyline coordinates={[{ latitude: pickupLoc.lat, longitude: pickupLoc.lng }, { latitude: destLoc.lat, longitude: destLoc.lng }]}
            strokeColor={JIH.gold} strokeWidth={3} lineDashPattern={[8, 4]} />
        )}
      </MapView>
      {!pickupLoc && <View style={ss.mapHint}><Text style={ss.mapHintTxt}>Tap map to set pickup · Type to search</Text></View>}

      <GoldTabs tabs={MODES} active={mode} onPress={id => { setMode(id as BookingMode); setActiveField(null); }} />

      <View style={ss.locWrap}>
        <LocationInputCard pickupText={pickupText} destText={destText}
          onPickupChange={v => { setPickupText(v); setPickupLoc(null); }} onDestChange={v => { setDestText(v); setDestLoc(null); }}
          onPickupFocus={() => setActiveField('pickup')} onDestFocus={() => setActiveField('dest')}
          onClearPickup={() => { setPickupLoc(null); setPickupText(''); setActiveField('pickup'); }}
          onClearDest={() => { setDestLoc(null); setDestText(''); setActiveField('dest'); }}
          onGps={handleGps} gpsLoading={gpsLoading} mode={mode} />
      </View>

      {activeField ? (
        <View style={ss.locWrap}>
          <SuggestionsList query={activeQuery} activeField={activeField} onSelect={handleSelect}
            onGps={() => { setActiveField(null); handleGps(); }} />
        </View>
      ) : (
        <>
          <ScrollView style={ss.formScroll} contentContainerStyle={ss.formContent}
            keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {mode === 'scheduled' && (
              <>
                <Text style={ss.sectionLbl}>Choose time</Text>
                <View style={ss.presetsRow}>
                  {presets.map(p => (
                    <Pressable key={p.iso} onPress={() => setSchedPreset(p.iso)} style={[ss.preset, schedPreset === p.iso && ss.presetOn]}>
                      <Text style={[ss.presetTxt, schedPreset === p.iso && ss.presetTxtOn]}>{p.label}</Text>
                    </Pressable>
                  ))}
                </View>
              </>
            )}
            {mode === 'full_day' && (
              <>
                <Text style={ss.sectionLbl}>Trip description</Text>
                <View style={ss.locCard}>
                  <TextInput style={[ss.locInput, { paddingVertical: Spacing.two }]} placeholder="Describe your trip (optional)"
                    placeholderTextColor={JIH.w30} value={hireDesc} onChangeText={setHireDesc} multiline numberOfLines={2} />
                </View>
                <Text style={ss.sectionLbl}>Your offered price (USD)</Text>
                <View style={ss.locCard}>
                  <View style={ss.locRow}>
                    <Text style={ss.dollarSign}>$</Text>
                    <TextInput style={ss.locInput} placeholder="e.g. 25" placeholderTextColor={JIH.w30}
                      value={offeredFare} onChangeText={setOfferedFare} keyboardType="decimal-pad" />
                  </View>
                </View>
              </>
            )}
            <Text style={ss.sectionLbl}>Choose ride type</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={ss.vScroll}>
              {VEHICLES.map(v => (
                <VehicleCard key={v.type} v={v} selected={vehicle === v.type}
                  onPress={() => { setVehicle(v.type); if (groupSize > v.maxSeats) setGroupSize(1); }} />
              ))}
            </ScrollView>
            {vehicle !== 'moto' && (
              <>
                <Text style={ss.sectionLbl}>Passengers</Text>
                <View style={ss.groupRow}>
                  {Array.from({ length: selV.maxSeats }, (_, i) => i + 1).map(n => (
                    <Pressable key={n} onPress={() => setGroupSize(n)} style={[ss.groupPill, groupSize === n && ss.groupPillOn]}>
                      <Text style={[ss.groupPillTxt, groupSize === n && ss.groupPillTxtOn]}>{n}</Text>
                    </Pressable>
                  ))}
                </View>
              </>
            )}
            <Text style={ss.sectionLbl}>Payment method</Text>
            <View style={ss.pmList}>
              {PAYMENTS.map(p => <PaymentOption key={p.id} p={p} selected={payment === p.id} onPress={() => setPayment(p.id)} />)}
            </View>
            {mode !== 'full_day' && (
              <View style={ss.fareRow}>
                <Text style={ss.fareLbl}>Estimated fare</Text>
                <Text style={ss.fareVal}>From ${selV.baseFare.toFixed(2)}</Text>
              </View>
            )}
            <View style={{ height: 90 }} />
          </ScrollView>
          <View style={ss.bookBtnWrap}>
            <Pressable onPress={handleBook} disabled={loading} style={({ pressed }) => [ss.bookBtn, { opacity: pressed || loading ? 0.8 : 1 }]}>
              {loading ? <ActivityIndicator color={JIH.navy} /> : <Text style={ss.bookBtnTxt}>{bookLabel}</Text>}
            </Pressable>
          </View>
        </>
      )}
    </View>
  );
}

// ─── MyRides ──────────────────────────────────────────────────────────────────

type HistorySection = 'upcoming' | 'scheduled' | 'past';
const HIST: { id: HistorySection; label: string }[] = [
  { id: 'upcoming', label: 'Upcoming' }, { id: 'scheduled', label: 'Scheduled' }, { id: 'past', label: 'Past' },
];
const ACTIVE_S = ['pending', 'matched', 'arrived', 'in_progress'];

function MyRides({ refresh }: { refresh: number }) {
  const [section, setSection] = useState<HistorySection>('upcoming');
  const [rides,   setRides]   = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setRides(await apiFetch()); }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed to load'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load, refresh]);

  const handleCancel = useCallback(async (id: string) => {
    try { await apiCancel(id); await load(); }
    catch (e) { Alert.alert('Error', e instanceof Error ? e.message : 'Failed'); }
  }, [load]);

  const upcoming  = rides.filter(r => ACTIVE_S.includes(r.status));
  const scheduled = rides.filter(r => r.status === 'scheduled');
  const past      = rides.filter(r => !ACTIVE_S.includes(r.status) && r.status !== 'scheduled');
  const shown     = section === 'upcoming' ? upcoming : section === 'scheduled' ? scheduled : past;
  const completed = past.filter(r => r.status === 'completed');
  const monthSpent = completed.reduce((s, r) => s + (r.offered_fare ?? r.estimated_fare ?? 0), 0);

  return (
    <>
      <GoldTabs tabs={HIST} active={section} onPress={id => setSection(id as HistorySection)} />
      {loading ? (
        <View style={ss.state}><ActivityIndicator color={JIH.gold} size="large" /><Text style={ss.stateTxt}>Loading…</Text></View>
      ) : error ? (
        <View style={ss.state}>
          <Text style={ss.stateEmoji}>⚠️</Text><Text style={ss.stateTxt}>{error}</Text>
          <Pressable onPress={load} style={ss.retryBtn}><Text style={ss.retryTxt}>Retry</Text></Pressable>
        </View>
      ) : (
        <ScrollView style={ss.ridesScroll} contentContainerStyle={ss.ridesContent} showsVerticalScrollIndicator={false}>
          {section === 'past' && completed.length > 0 && (
            <View style={ss.summCard}>
              <Text style={ss.summTitle}>This month</Text>
              <View style={ss.summRow}>
                {[['Rides', String(completed.length)], ['Total', `$${monthSpent.toFixed(2)}`],
                  ['Avg', `$${completed.length ? (monthSpent / completed.length).toFixed(2) : '0.00'}`]].map(([l, v], i) => (
                  <View key={i} style={ss.summItem}><Text style={ss.summVal}>{v}</Text><Text style={ss.summLbl}>{l}</Text></View>
                ))}
              </View>
            </View>
          )}
          {shown.length === 0 ? (
            <View style={ss.state}>
              <Text style={ss.stateEmoji}>🗺️</Text>
              <Text style={ss.stateTitle}>{section === 'upcoming' ? 'No active rides' : section === 'scheduled' ? 'No scheduled rides' : 'No past rides'}</Text>
              <Text style={ss.stateTxt}>{section === 'past' ? 'Completed and cancelled rides appear here.' : 'Book a ride to get started.'}</Text>
            </View>
          ) : shown.map(r => <RideCard key={r.id} ride={r} onCancel={handleCancel} />)}
        </ScrollView>
      )}
    </>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

type MainTab = 'book' | 'rides';
const MAIN_TABS: { id: MainTab; label: string }[] = [
  { id: 'book', label: 'Book a Ride' }, { id: 'rides', label: 'My Rides' },
];

export default function BookingScreen() {
  const insets               = useSafeAreaInsets();
  const [tab, setTab]        = useState<MainTab>('book');
  const [refresh, setRefresh]= useState(0);
  const [userId, setUserId]  = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const indX     = useSharedValue(0);
  // Must be declared before any conditional return to keep hook order stable
  const indStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: withTiming(indX.value, { duration: 180 }) }],
  }));

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUserId(session?.user?.id ?? null);
      setAuthLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user?.id ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  if (authLoading) {
    return <View style={[ss.screen, { justifyContent: 'center', alignItems: 'center', paddingTop: insets.top }]}><ActivityIndicator color={JIH.gold} size="large" /></View>;
  }

  if (!userId) {
    return <SignInScreen onSignedIn={() => { supabase.auth.getUser().then(({ data: { user } }) => setUserId(user?.id ?? null)); }} />;
  }

  return (
    <KeyboardAvoidingView style={[ss.screen, { paddingTop: insets.top }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={ss.header}>
        <View><Text style={ss.hTitle}>JihWolrd</Text><Text style={ss.hGold}>Rides</Text></View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
          <View style={ss.hBadge}><Text style={ss.hBadgeTxt}>🛺</Text></View>
          <Pressable onPress={() => supabase.auth.signOut()} style={ss.signOutBtn}>
            <Text style={ss.signOutTxt}>Sign out</Text>
          </Pressable>
        </View>
      </View>

      <View style={ss.mainTabBar}>
        {MAIN_TABS.map(t => {
          const on = tab === t.id;
          return (
            <Pressable key={t.id} style={ss.mainTab} onPress={() => { setTab(t.id); indX.value = t.id === 'rides' ? 1 : 0; }}>
              <Text style={[ss.mainTabTxt, on ? ss.mainTabOn : ss.mainTabOff]}>{t.label}</Text>
            </Pressable>
          );
        })}
        <Animated.View style={[ss.mainInd, indStyle, { width: `${100 / MAIN_TABS.length}%` }]} />
      </View>

      <View style={[ss.content, { paddingBottom: insets.bottom + BottomTabInset }]}>
        {tab === 'book'
          ? <BookForm onBooked={() => { setRefresh(n => n + 1); setTab('rides'); }} />
          : <MyRides refresh={refresh} />}
      </View>
    </KeyboardAvoidingView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const ss = StyleSheet.create({
  screen:  { flex: 1, backgroundColor: JIH.navy },
  content: { flex: 1 },

  // Auth screen
  authScreen:  { flex: 1, backgroundColor: JIH.navy },
  authScroll:  { flexGrow: 1, justifyContent: 'center', padding: Spacing.four, gap: Spacing.three },
  authLogo:    { alignItems: 'center', gap: Spacing.two, marginBottom: Spacing.one },
  authEmoji:   { fontSize: 52 },
  authTitle:   { color: JIH.white, fontSize: 26, fontWeight: '700', letterSpacing: -0.5 },
  authSub:     { color: JIH.w55, fontSize: 14 },
  authCard:    { backgroundColor: JIH.navyM, borderRadius: 16, padding: Spacing.three, borderWidth: 1, borderColor: JIH.navyXL },
  authLabel:   { color: JIH.w55, fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 5 },
  authInput:   { backgroundColor: JIH.navyL, borderRadius: 10, borderWidth: 1, borderColor: JIH.navyXL, color: JIH.white, fontSize: 15, paddingHorizontal: Spacing.three, paddingVertical: 11 },
  authBtn:     { backgroundColor: JIH.gold, borderRadius: 14, paddingVertical: 14, alignItems: 'center', shadowColor: JIH.gold, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.35, shadowRadius: 12, elevation: 8 },
  authBtnTxt:  { color: JIH.navy, fontSize: 16, fontWeight: '700' },
  authBtnOutline:    { borderWidth: 1.5, borderColor: JIH.gold, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  authBtnOutlineTxt: { color: JIH.gold, fontSize: 15, fontWeight: '600' },
  authSwitch:    { alignItems: 'center', paddingVertical: Spacing.two },
  authSwitchTxt: { color: JIH.gold, fontSize: 14 },
  authSwitchRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', paddingTop: Spacing.two },
  authSwitchMuted: { color: JIH.w55, fontSize: 14 },
  formGroup:   { gap: Spacing.two },

  // OAuth buttons
  oauthBtn:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.two, borderWidth: 1.5, borderColor: JIH.navyXL, borderRadius: 12, paddingVertical: 12, backgroundColor: JIH.navyM },
  oauthBtnApple:  { backgroundColor: JIH.white },
  oauthIcon:      { color: JIH.white, fontSize: 16, fontWeight: '900', width: 22, textAlign: 'center' },
  oauthIconApple: { color: JIH.navy },
  oauthTxt:       { color: JIH.white, fontSize: 15, fontWeight: '600' },
  oauthTxtApple:  { color: JIH.navy },

  // OR divider
  orRow:  { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  orLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: JIH.navyXL },
  orTxt:  { color: JIH.w30, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.8 },

  // Auth tab switcher
  authTabBar:   { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: JIH.navyXL },
  authTab:      { flex: 1, alignItems: 'center', paddingBottom: 8, paddingTop: 4, position: 'relative' },
  authTabTxt:   { fontSize: 14, fontWeight: '600' },
  authTabOn:    { color: JIH.gold },
  authTabOff:   { color: JIH.w55 },
  authTabUnder: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 2, backgroundColor: JIH.gold, borderRadius: 1 },

  // Password input with eye toggle
  pwdRow:   { flexDirection: 'row', alignItems: 'center', backgroundColor: JIH.navyL, borderRadius: 10, borderWidth: 1, borderColor: JIH.navyXL, paddingRight: Spacing.two },
  pwdInput: { flex: 1, color: JIH.white, fontSize: 15, paddingHorizontal: Spacing.three, paddingVertical: 11 },
  pwdEye:   { padding: 6 },
  pwdEyeTxt:{ fontSize: 16 },

  // Password strength bar
  strengthWrap: { marginTop: 6, gap: 4 },
  strengthBar:  { flexDirection: 'row', gap: 3 },
  strengthSeg:  { flex: 1, height: 4, borderRadius: 2 },
  strengthLbl:  { fontSize: 11, fontWeight: '600' },

  // Phone input
  phoneRow:       { flexDirection: 'row', borderRadius: 10, borderWidth: 1, borderColor: JIH.navyXL, overflow: 'hidden' },
  phonePrefix:    { backgroundColor: JIH.navyL, paddingHorizontal: Spacing.three, justifyContent: 'center', borderRightWidth: 1, borderRightColor: JIH.navyXL },
  phonePrefixTxt: { color: JIH.w55, fontSize: 14, fontWeight: '600' },
  phoneInput:     { flex: 1, backgroundColor: JIH.navyL, color: JIH.white, fontSize: 15, paddingHorizontal: Spacing.three, paddingVertical: 11 },

  // Field error
  fieldError: { color: '#EF4444', fontSize: 11, marginTop: 3 },

  // Terms checkbox
  termsRow:  { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two, paddingTop: Spacing.one },
  checkbox:  { width: 20, height: 20, borderRadius: 5, borderWidth: 2, borderColor: JIH.navyXL, backgroundColor: JIH.navyL, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  checkboxOn:{ borderColor: JIH.gold, backgroundColor: JIH.gold },
  checkmark: { color: JIH.navy, fontSize: 12, fontWeight: '700' },
  termsTxt:  { flex: 1, color: JIH.w55, fontSize: 13, lineHeight: 19 },
  termsLink: { color: JIH.gold },

  // Header
  header:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.four, paddingVertical: Spacing.two, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: JIH.navyXL },
  hTitle:    { color: JIH.white, fontSize: 20, fontWeight: '700', letterSpacing: -0.3 },
  hGold:     { color: JIH.gold,  fontSize: 12, fontWeight: '600', letterSpacing: 1 },
  hBadge:    { width: 36, height: 36, borderRadius: 18, backgroundColor: JIH.navyM, alignItems: 'center', justifyContent: 'center' },
  hBadgeTxt: { fontSize: 17 },
  signOutBtn: { paddingHorizontal: Spacing.two, paddingVertical: 4, borderRadius: 8, borderWidth: 1, borderColor: JIH.navyXL },
  signOutTxt: { color: JIH.w55, fontSize: 12, fontWeight: '600' },

  // Main tab bar
  mainTabBar: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: JIH.navyXL, position: 'relative' },
  mainTab:    { flex: 1, paddingVertical: 10, alignItems: 'center' },
  mainTabTxt: { fontSize: 14, fontWeight: '600' },
  mainTabOn:  { color: JIH.white },
  mainTabOff: { color: JIH.w55 },
  mainInd:    { position: 'absolute', bottom: 0, left: 0, height: 2, backgroundColor: JIH.gold },

  // Mode bar
  modebar:  { flexDirection: 'row', paddingHorizontal: Spacing.four, paddingTop: Spacing.two, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: JIH.navyXL, gap: 20 },
  modeBtn:  { paddingBottom: Spacing.one + 2, position: 'relative' },
  modeTxt:  { fontSize: 13, fontWeight: '600' },
  modeTxtOn:  { color: JIH.gold },
  modeTxtOff: { color: JIH.w55 },
  modeUnder:{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 2, backgroundColor: JIH.gold, borderRadius: 1 },

  // Map
  map:        { height: MAP_HEIGHT, width: '100%' },
  mapHint:    { position: 'absolute', top: MAP_HEIGHT - 28, left: 0, right: 0, alignItems: 'center' },
  mapHintTxt: { backgroundColor: 'rgba(0,0,0,0.5)', color: JIH.white, fontSize: 11, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10 },

  // Location
  locWrap:    { paddingHorizontal: Spacing.three, paddingTop: Spacing.two },
  locCard:    { backgroundColor: JIH.navyM, borderRadius: 14, borderWidth: 1, borderColor: JIH.navyXL },
  locRow:     { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.three, paddingVertical: 10, gap: Spacing.two },
  locDivider: { height: StyleSheet.hairlineWidth, backgroundColor: JIH.navyXL, marginLeft: Spacing.three + 12 + Spacing.two },
  locInput:   { flex: 1, color: JIH.white, fontSize: 14, fontWeight: '500' },
  dot:        { width: 12, height: 12, borderRadius: 6 },
  dotG:       { backgroundColor: '#22C55E' },
  dotR:       { backgroundColor: '#EF4444' },
  iconBtn:    { padding: 4 },
  iconBtnTxt: { fontSize: 18 },
  clearTxt:   { color: JIH.w55, fontSize: 13, fontWeight: '700' },
  dollarSign: { color: JIH.gold, fontSize: 17, fontWeight: '700' },

  // Suggestions
  suggBox:     { backgroundColor: JIH.navyM, borderRadius: 12, borderWidth: 1, borderColor: JIH.navyXL, marginTop: 4, overflow: 'hidden', maxHeight: 260 },
  suggGps:     { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.three, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: JIH.navyXL, gap: Spacing.two },
  suggGpsIcon: { fontSize: 16 },
  suggGpsLbl:  { color: JIH.gold, fontSize: 14, fontWeight: '600' },
  suggSect:    { paddingHorizontal: Spacing.three, paddingVertical: 6 },
  suggSectLbl: { color: JIH.w30, fontSize: 10, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.8 },
  suggRow:     { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: Spacing.three, paddingVertical: 9, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: JIH.navyXL, gap: Spacing.two },
  suggPin:     { fontSize: 13, marginTop: 1 },
  suggName:    { color: JIH.white, fontSize: 13, fontWeight: '600' },
  suggAddr:    { color: JIH.w55, fontSize: 12, flex: 1 },
  suggInfo:    { flex: 1 },
  suggLoadRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: Spacing.three, gap: Spacing.two },
  suggLoadTxt: { color: JIH.w55, fontSize: 13 },

  // Form scroll
  sectionLbl:  { color: JIH.w55, fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.8, marginTop: Spacing.two },
  formScroll:  { flex: 1 },
  formContent: { paddingHorizontal: Spacing.three, paddingTop: Spacing.two, gap: Spacing.two, paddingBottom: 100 },
  presetsRow:  { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  preset:      { paddingHorizontal: Spacing.three, paddingVertical: 8, borderRadius: 20, borderWidth: 1.5, borderColor: JIH.navyXL, backgroundColor: JIH.navyM },
  presetOn:    { borderColor: JIH.gold, backgroundColor: `${JIH.gold}1A` },
  presetTxt:   { color: JIH.w55, fontSize: 13, fontWeight: '600' },
  presetTxtOn: { color: JIH.gold },

  // Vehicle
  vScroll:   { gap: Spacing.two, paddingVertical: 4 },
  vCard:     { alignItems: 'center', width: 88, paddingVertical: 10, paddingHorizontal: Spacing.two, borderRadius: 14, borderWidth: 1.5, borderColor: JIH.navyXL, backgroundColor: JIH.navyM, gap: 3 },
  vCardOn:   { borderColor: JIH.gold, backgroundColor: `${JIH.gold}15` },
  vIcon:     { fontSize: 26 },
  vLabel:    { color: JIH.w55, fontSize: 12, fontWeight: '700' },
  vLabelOn:  { color: JIH.gold },
  vDesc:     { color: JIH.w30, fontSize: 10, textAlign: 'center' },
  vFare:     { color: JIH.w55, fontSize: 11, fontWeight: '600' },
  vFareOn:   { color: JIH.goldL },
  vSeats:    { color: JIH.w30, fontSize: 10 },

  // Group
  groupRow:       { flexDirection: 'row', gap: Spacing.two },
  groupPill:      { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: JIH.navyM, borderWidth: 1.5, borderColor: JIH.navyXL },
  groupPillOn:    { borderColor: JIH.gold, backgroundColor: `${JIH.gold}1A` },
  groupPillTxt:   { color: JIH.w55, fontSize: 15, fontWeight: '700' },
  groupPillTxtOn: { color: JIH.gold },

  // Payment
  pmList:    { gap: Spacing.two },
  pmOpt:     { flexDirection: 'row', alignItems: 'center', backgroundColor: JIH.navyM, borderRadius: 12, borderWidth: 1.5, borderColor: JIH.navyXL, padding: 10, gap: Spacing.two },
  pmOptOn:   { borderColor: JIH.gold },
  pmIcon:    { fontSize: 20 },
  pmInfo:    { flex: 1 },
  pmLabel:   { color: JIH.w70, fontSize: 14, fontWeight: '600' },
  pmLabelOn: { color: JIH.white },
  pmDesc:    { color: JIH.w30, fontSize: 11 },
  radio:     { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: JIH.w30, alignItems: 'center', justifyContent: 'center' },
  radioOn:   { borderColor: JIH.gold },
  radioDot:  { width: 8, height: 8, borderRadius: 4, backgroundColor: JIH.gold },

  // Fare / book
  fareRow:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: JIH.navyM, borderRadius: 12, padding: Spacing.three, borderWidth: 1, borderColor: JIH.navyXL },
  fareLbl:     { color: JIH.w55, fontSize: 14 },
  fareVal:     { color: JIH.gold, fontSize: 18, fontWeight: '700' },
  bookBtnWrap: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: Spacing.three, backgroundColor: JIH.navy, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: JIH.navyXL },
  bookBtn:     { backgroundColor: JIH.gold, borderRadius: 14, paddingVertical: Spacing.three, alignItems: 'center', shadowColor: JIH.gold, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.35, shadowRadius: 12, elevation: 8 },
  bookBtnTxt:  { color: JIH.navy, fontSize: 16, fontWeight: '700' },

  // My Rides
  ridesScroll:  { flex: 1 },
  ridesContent: { padding: Spacing.three, gap: Spacing.three, paddingBottom: Spacing.six },
  summCard:     { backgroundColor: JIH.navyM, borderRadius: 14, padding: Spacing.three, borderWidth: 1, borderColor: JIH.navyXL },
  summTitle:    { color: JIH.gold, fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: Spacing.two },
  summRow:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around' },
  summItem:     { alignItems: 'center' },
  summVal:      { color: JIH.white, fontSize: 18, fontWeight: '700' },
  summLbl:      { color: JIH.w55, fontSize: 11, marginTop: 2 },
  rideCard:     { backgroundColor: JIH.navyM, borderRadius: 16, borderWidth: 1, borderColor: JIH.navyXL, padding: Spacing.three, gap: Spacing.two },
  rideHdr:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rideDate:     { color: JIH.w30, fontSize: 11 },
  routeRow:     { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  routeDots:    { alignItems: 'center', gap: 3, paddingVertical: 2 },
  rdot:         { width: 10, height: 10, borderRadius: 5 },
  rdotG:        { backgroundColor: '#22C55E' },
  rdotR:        { backgroundColor: '#EF4444' },
  rline:        { width: 2, height: 18, backgroundColor: JIH.navyXL },
  routeAddrs:   { flex: 1, gap: 8 },
  addrPrimary:  { color: JIH.white, fontSize: 14, fontWeight: '500' },
  addrSec:      { color: JIH.w55, fontSize: 13 },
  rideFooter:   { gap: Spacing.two },
  chips:        { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one },
  chip:         { backgroundColor: JIH.navyL, paddingHorizontal: Spacing.two, paddingVertical: 4, borderRadius: 6 },
  chipTxt:      { color: JIH.w55, fontSize: 12, fontWeight: '500' },
  cancelBtn:    { alignSelf: 'flex-end', backgroundColor: '#FEE2E2', paddingHorizontal: Spacing.three, paddingVertical: 6, borderRadius: 8 },
  cancelTxt:    { color: '#991B1B', fontSize: 12, fontWeight: '700' },

  // Status pill
  pill:    { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  pillTxt: { fontSize: 11, fontWeight: '700' },

  // States
  state:      { alignItems: 'center', justifyContent: 'center', paddingVertical: Spacing.six, gap: Spacing.two },
  stateEmoji: { fontSize: 44 },
  stateTitle: { color: JIH.white, fontSize: 18, fontWeight: '700' },
  stateTxt:   { color: JIH.w55, fontSize: 14, textAlign: 'center' },
  retryBtn:   { backgroundColor: JIH.gold, paddingHorizontal: Spacing.four, paddingVertical: Spacing.two, borderRadius: 10, marginTop: 4 },
  retryTxt:   { color: JIH.navy, fontWeight: '700', fontSize: 14 },
});
