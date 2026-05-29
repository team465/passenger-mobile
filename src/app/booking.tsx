/**
 * Passenger booking screen — JihWolrd design system
 * - SF Symbols via expo-symbols (no emoji in functional UI)
 * - Color-coded vehicles with accent strips
 * - Floating location card over map
 * - Connected route line in location input
 */
import * as Location from 'expo-location';
import * as WebBrowser from 'expo-web-browser';
import { makeRedirectUri } from 'expo-auth-session';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useRef, useState } from 'react';
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
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomTabInset, Spacing } from '@/constants/theme';
import { supabase } from '@/lib/supabase';

WebBrowser.maybeCompleteAuthSession();

// ─── jihwolrd colour palette ──────────────────────────────────────────────────

const JIH = {
  navy:  '#111E2C', navyM: '#1B2A3B', navyL: '#253548', navyXL: '#2F4258',
  gold:  '#E8A020', goldL: '#F5B83A', goldD: '#C4841A',
  white: '#FFFFFF',
  w70:   'rgba(255,255,255,0.70)', w55: 'rgba(255,255,255,0.55)',
  w30:   'rgba(255,255,255,0.30)', w15: 'rgba(255,255,255,0.15)',
  w10:   'rgba(255,255,255,0.10)',
} as const;


const SIEM_REAP  = { latitude: 13.3671, longitude: 103.8498, latitudeDelta: 0.06, longitudeDelta: 0.06 };

// ─── SF Symbol wrapper ────────────────────────────────────────────────────────
// Uses native SF Symbols on iOS; falls back to a small colored dot on Android

function Sym({ name, size = 18, color = JIH.white, style }: {
  name: string; size?: number; color?: string; style?: object;
}) {
  if (Platform.OS === 'ios') {
    return (
      <SymbolView
        name={name as Parameters<typeof SymbolView>[0]['name']}
        size={size}
        tintColor={color}
        style={[{ width: size, height: size }, style]}
      />
    );
  }
  // Android/web: neutral filled square as placeholder
  return <View style={[{ width: size, height: size, borderRadius: 3, backgroundColor: color, opacity: 0.85 }, style]} />;
}

// ─── Quick suggestions (mirrors jihwolrd LocationSearch.tsx) ─────────────────

type LocResult = { address: string; lat: number; lng: number };

const QUICK_SUGGESTIONS: (LocResult & { name: string })[] = [
  { name: 'Angkor Wat',             lat: 13.4125, lng: 103.8670, address: 'Angkor Wat, Siem Reap' },
  { name: 'Pub Street',             lat: 13.3533, lng: 103.8560, address: 'Pub Street, Siem Reap' },
  { name: 'Siem Reap Airport',      lat: 13.4117, lng: 103.8133, address: 'Siem Reap International Airport' },
  { name: 'Old Market (Psar Chas)', lat: 13.3531, lng: 103.8590, address: 'Old Market, Siem Reap' },
  { name: 'Angkor Night Market',    lat: 13.3585, lng: 103.8555, address: 'Angkor Night Market, Siem Reap' },
  { name: 'Royal Residence',        lat: 13.3620, lng: 103.8597, address: 'Royal Residence, Siem Reap' },
];

// ─── Nominatim geocoding ──────────────────────────────────────────────────────

const NOM_HDR = { 'User-Agent': 'JihWolrd-App/1.0', 'Accept-Language': 'en' };

async function searchPlaces(q: string): Promise<LocResult[]> {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=6&countrycodes=kh`, { headers: NOM_HDR });
    return ((await r.json()) as Array<{ display_name: string; lat: string; lon: string }>)
      .map(d => ({ address: d.display_name, lat: parseFloat(d.lat), lng: parseFloat(d.lon) }));
  } catch { return []; }
}

async function reverseGeocode(lat: number, lon: number): Promise<string> {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`, { headers: NOM_HDR });
    return ((await r.json()) as { display_name?: string }).display_name ?? 'Pinned location';
  } catch { return 'Pinned location'; }
}

// ─── Supabase API ─────────────────────────────────────────────────────────────

type Booking = {
  id: string; status: string; booking_type: string;
  pickup_address: string; destination_address: string | null;
  pickup_lat: number | null; pickup_lng: number | null;
  destination_lat: number | null; destination_lng: number | null;
  vehicle_type: string; ride_type: string; payment_method: string;
  estimated_fare: number | null; offered_fare: number | null;
  hire_description: string | null; scheduled_datetime: string | null;
  created_at: string; group_size: number;
  driver_name: string | null; driver_id: string | null;
};

async function getUserId() {
  // getSession() reads from AsyncStorage — no network call, works offline
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) throw new Error('Not signed in');
  return session.user.id;
}

async function apiCreate(payload: Record<string, unknown>): Promise<Booking> {
  const uid = await getUserId();
  const { data, error } = await supabase.from('rides').insert({
    passenger_id: uid, payment_status: 'pending', ride_type: 'private', booking_type: 'standard', group_size: 1, ...payload,
  }).select().single();
  if (error) throw new Error(error.message);
  return data as Booking;
}

async function apiFetch(): Promise<Booking[]> {
  const uid = await getUserId();
  const fields = 'id,status,booking_type,pickup_address,destination_address,pickup_lat,pickup_lng,destination_lat,destination_lng,vehicle_type,ride_type,payment_method,estimated_fare,offered_fare,hire_description,scheduled_datetime,created_at,group_size,driver_name,driver_id';
  const { data, error } = await supabase.from('rides').select(fields).eq('passenger_id', uid).order('created_at', { ascending: false }).limit(100);
  if (error) throw new Error(error.message);
  return (data ?? []) as Booking[];
}

async function apiCancel(id: string) {
  const { error } = await supabase.from('rides').update({ status: 'cancelled', cancelled_at: new Date().toISOString(), cancellation_reason: 'Cancelled by passenger via app' }).eq('id', id).in('status', ['pending', 'scheduled']);
  if (error) throw new Error(error.message);
}

// ─── Vehicles (mirrors VehicleSelector.tsx) ───────────────────────────────────

const VEHICLES = [
  { type: 'tuktuk', sfIcon: 'figure.wave',       label: 'Tuk Tuk', desc: 'Classic Cambodia', baseFare: 1.0, perKm: 0.4, maxSeats: 4, color: '#F59E0B', abbr: 'TUK' },
  { type: 'car',    sfIcon: 'car.fill',           label: 'Car',     desc: 'Comfortable & AC', baseFare: 1.5, perKm: 0.6, maxSeats: 5, color: '#3B82F6', abbr: 'CAR' },
  { type: 'moto',   sfIcon: 'bicycle.circle',     label: 'Moto',    desc: 'Fast & affordable',baseFare: 0.75,perKm: 0.3, maxSeats: 1, color: '#10B981', abbr: 'MOTO'},
  { type: 'van',    sfIcon: 'bus.fill',           label: 'Van',     desc: 'Groups up to 8',  baseFare: 2.0, perKm: 0.8, maxSeats: 8, color: '#8B5CF6', abbr: 'VAN' },
] as const;
type VehicleType = (typeof VEHICLES)[number]['type'];

// ─── Payments ─────────────────────────────────────────────────────────────────

const PAYMENTS = [
  { id: 'cash', sfIcon: 'banknote',          label: 'Cash',  desc: 'Pay driver after ride',  color: '#10B981' },
  { id: 'card', sfIcon: 'creditcard.fill',   label: 'Card',  desc: 'Demo only',              color: '#3B82F6' },
  { id: 'aba',  sfIcon: 'building.columns',  label: 'ABA',   desc: 'Transfer via ABA Bank',  color: '#F59E0B' },
  { id: 'wing', sfIcon: 'phone.fill',        label: 'Wing',  desc: 'Send via Wing transfer', color: '#EF4444' },
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

// Status left border color for ride cards
const STATUS_BORDER: Record<string, string> = {
  pending: '#9CA3AF', matched: '#8B5CF6', arrived: '#F59E0B',
  in_progress: '#3B82F6', completed: '#10B981', cancelled: '#EF4444', scheduled: '#6B7280',
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

// ─── Cambodian phone utils ────────────────────────────────────────────────────

const sanitizeKhDigits = (raw: string) => { const d = (raw ?? '').replace(/\D/g, ''); return d.startsWith('0') ? d.slice(1) : d; };
const formatKhMask   = (d: string) => { const s = sanitizeKhDigits(d); if (s.length <= 2) return s; if (s.length <= 5) return `${s.slice(0, 2)} ${s.slice(2)}`; return `${s.slice(0, 2)} ${s.slice(2, 5)} ${s.slice(5, 12)}`; };
const composeKhPhone = (d: string) => { const s = sanitizeKhDigits(d); return s ? `+855${s}` : ''; };
const isValidKhPhone = (d: string) => { const s = sanitizeKhDigits(d); return s.length >= 8 && s.length <= 9; };

// ─── Password strength ────────────────────────────────────────────────────────

const getPwStrength = (pw: string) => { let s = 0; if (pw.length >= 8) s++; if (/[A-Z]/.test(pw)) s++; if (/[0-9]/.test(pw)) s++; if (/[^A-Za-z0-9]/.test(pw)) s++; return s; };
const STRENGTH_LABEL = ['Very weak', 'Weak', 'Fair', 'Strong'];
const STRENGTH_COLOR = ['#EF4444', '#F97316', '#EAB308', '#22C55E'];

// ─── Shared components ────────────────────────────────────────────────────────

function StatusPill({ status }: { status: string }) {
  const c = STATUS_PILL[status] ?? STATUS_PILL.pending;
  return <View style={[ss.pill, { backgroundColor: c.bg }]}><Text style={[ss.pillTxt, { color: c.color }]}>{c.label}</Text></View>;
}

function GoldTabs({ tabs, active, onPress }: { tabs: { id: string; label: string }[]; active: string; onPress: (id: string) => void }) {
  return (
    <View style={ss.modebar}>
      {tabs.map(t => {
        const on = active === t.id;
        return (
          <Pressable key={t.id} style={ss.modeBtn} onPress={() => onPress(t.id)}>
            <Text style={[ss.modeTxt, on ? ss.modeTxtOn : ss.modeTxtOff]}>{t.label}</Text>
            <View style={[ss.modeUnder, on ? ss.modeUnderOn : ss.modeUnderOff]} />
          </Pressable>
        );
      })}
    </View>
  );
}

// ─── PasswordInput ────────────────────────────────────────────────────────────

function PasswordInput({ placeholder, value, onChangeText, returnKeyType, onSubmitEditing, inputRef }: {
  placeholder: string; value: string; onChangeText: (v: string) => void;
  returnKeyType?: 'next' | 'done'; onSubmitEditing?: () => void;
  inputRef?: React.RefObject<TextInput | null>;
}) {
  const [show, setShow] = useState(false);
  return (
    <View style={ss.pwdRow}>
      <TextInput ref={inputRef} style={ss.pwdInput} placeholder={placeholder} placeholderTextColor={JIH.w30}
        value={value} onChangeText={onChangeText} secureTextEntry={!show} autoCapitalize="none"
        returnKeyType={returnKeyType ?? 'done'} onSubmitEditing={onSubmitEditing} />
      <Pressable onPress={() => setShow(v => !v)} style={ss.pwdEye} hitSlop={8}>
        <Sym name={show ? 'eye.slash' : 'eye'} size={17} color={JIH.w55} />
      </Pressable>
    </View>
  );
}

// ─── Sign-In / Sign-Up Screen ─────────────────────────────────────────────────

type AuthTab = 'login' | 'signup';

function SignInScreen({ onSignedIn }: { onSignedIn: () => void }) {
  const [tab,           setTab]          = useState<AuthTab>('signup');
  const [loading,       setLoading]      = useState(false);
  const [googleLoading, setGLoader]      = useState(false);
  const [appleLoading,  setALoader]      = useState(false);
  const [verifyEmail,   setVerifyEmail]  = useState('');
  const [loginEmail,  setLoginEmail]  = useState('');
  const [loginPwd,    setLoginPwd]    = useState('');
  const [fullName,    setFullName]    = useState('');
  const [signEmail,   setSignEmail]   = useState('');
  const [phone,       setPhone]       = useState('');
  const [pwd,         setPwd]         = useState('');
  const [confirmPwd,  setConfirmPwd]  = useState('');
  const [agreed,      setAgreed]      = useState(false);
  const pwStrength = getPwStrength(pwd);
  const loginPwdRef = useRef<TextInput>(null);
  const emailRef    = useRef<TextInput>(null);
  const phoneRef    = useRef<TextInput>(null);
  const pwdRef      = useRef<TextInput>(null);
  const confirmRef  = useRef<TextInput>(null);

  const handleOAuth = async (provider: 'google' | 'apple', setL: (v: boolean) => void) => {
    setL(true);
    try {
      const redirectTo = makeRedirectUri({ scheme: 'myapp', path: 'auth/callback' });
      const { data, error } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo, skipBrowserRedirect: true } });
      if (error) throw error;
      if (!data.url) throw new Error('No OAuth URL');
      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
      if (result.type === 'success' && result.url) {
        const params = Object.fromEntries(new URLSearchParams(result.url.split('#')[1] ?? result.url.split('?')[1] ?? ''));
        if (params.access_token) {
          const { error: e } = await supabase.auth.setSession({ access_token: params.access_token, refresh_token: params.refresh_token ?? '' });
          if (e) throw e;
          const { data: { user } } = await supabase.auth.getUser();
          if (user) {
            const { data: role } = await supabase.from('user_roles').select('role').eq('user_id', user.id).maybeSingle();
            if (!role) await supabase.from('user_roles').insert({ user_id: user.id, role: 'passenger' });
            onSignedIn();
          }
        }
      }
    } catch (e) { Alert.alert('Error', e instanceof Error ? e.message : `${provider} sign in failed`); }
    finally { setL(false); }
  };

  const handleLogin = async () => {
    if (!loginEmail.trim() || !loginPwd) { Alert.alert('Required', 'Enter email and password.'); return; }
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

  const handleSignUp = async () => {
    if (!fullName.trim())  { Alert.alert('Required', 'Please enter your full name.'); return; }
    if (!signEmail.trim()) { Alert.alert('Required', 'Please enter your email.'); return; }
    if (pwd.length < 8)    { Alert.alert('Too short', 'Password must be at least 8 characters.'); return; }
    if (pwd !== confirmPwd){ Alert.alert('Mismatch', 'Passwords do not match.'); return; }
    if (phone && !isValidKhPhone(phone)) { Alert.alert('Invalid phone', 'Enter a valid Cambodian number (+855 XX XXX XXXX).'); return; }
    if (!agreed) { Alert.alert('Terms required', 'Please agree to the Terms of Service.'); return; }
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signUp({ email: signEmail.trim(), password: pwd, options: { data: { full_name: fullName.trim(), role: 'passenger' } } });
      if (error) throw error;
      if (data.user) {
        if (phone) await supabase.from('profiles').update({ phone: composeKhPhone(phone) }).eq('id', data.user.id);
        if (data.user.email_confirmed_at || data.session) { onSignedIn(); }
        else { setVerifyEmail(signEmail.trim()); }
      }
    } catch (e) { Alert.alert('Error', e instanceof Error ? e.message : 'Sign up failed'); }
    finally { setLoading(false); }
  };

  const handleResend = async () => {
    setLoading(true);
    try {
      const { error } = await supabase.auth.resend({ type: 'signup', email: verifyEmail });
      if (error) throw error;
      Alert.alert('Sent', 'Verification email resent!');
    } catch (e) { Alert.alert('Error', e instanceof Error ? e.message : 'Failed'); }
    finally { setLoading(false); }
  };

  if (verifyEmail) {
    return (
      <KeyboardAvoidingView style={ss.authScreen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={[ss.authScroll, { justifyContent: 'center' }]} keyboardShouldPersistTaps="handled">
          <View style={ss.authLogo}>
            <View style={[ss.authIconCircle, { backgroundColor: `${JIH.gold}22` }]}>
              <Sym name="envelope.badge.fill" size={36} color={JIH.gold} />
            </View>
            <Text style={ss.authTitle}>Almost there!</Text>
            <Text style={[ss.authSub, { textAlign: 'center' }]}>
              Verification link sent to{'\n'}<Text style={{ color: JIH.gold }}>{verifyEmail}</Text>
            </Text>
          </View>
          <Pressable onPress={handleResend} disabled={loading} style={({ pressed }) => [ss.authBtnOutline, { opacity: pressed || loading ? 0.7 : 1 }]}>
            {loading ? <ActivityIndicator color={JIH.gold} /> : <Text style={ss.authBtnOutlineTxt}>Resend verification email</Text>}
          </Pressable>
          <Pressable onPress={() => { setVerifyEmail(''); setTab('login'); }} style={ss.authSwitch}>
            <Text style={ss.authSwitchTxt}>Back to Log In</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  return (
    <KeyboardAvoidingView style={ss.authScreen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={ss.authScroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={ss.authLogo}>
          <View style={ss.authLogoMark}>
            <Text style={ss.authLogoTxt}>JIH</Text>
          </View>
          <Text style={ss.authTitle}>JihWolrd Rides</Text>
          <Text style={ss.authSub}>Passenger Account</Text>
        </View>

        {/* OAuth */}
        <Pressable onPress={() => handleOAuth('google', setGLoader)} disabled={googleLoading || loading}
          style={({ pressed }) => [ss.oauthBtn, { opacity: pressed || googleLoading ? 0.7 : 1 }]}>
          {googleLoading ? <ActivityIndicator color={JIH.white} size="small" /> : (
            <><View style={[ss.oauthDot, { backgroundColor: '#4285F4' }]}><Text style={ss.oauthDotTxt}>G</Text></View><Text style={ss.oauthTxt}>Continue with Google</Text></>
          )}
        </Pressable>
        <Pressable onPress={() => handleOAuth('apple', setALoader)} disabled={appleLoading || loading}
          style={({ pressed }) => [ss.oauthBtn, ss.oauthBtnApple, { opacity: pressed || appleLoading ? 0.7 : 1 }]}>
          {appleLoading ? <ActivityIndicator color={JIH.navy} size="small" /> : (
            <><Sym name="apple.logo" size={18} color={JIH.navy} /><Text style={[ss.oauthTxt, { color: JIH.navy }]}>Continue with Apple</Text></>
          )}
        </Pressable>

        <View style={ss.orRow}><View style={ss.orLine} /><Text style={ss.orTxt}>or continue with email</Text><View style={ss.orLine} /></View>

        {/* Tabs */}
        <View style={ss.authTabBar}>
          {(['signup', 'login'] as AuthTab[]).map(t => (
            <Pressable key={t} style={ss.authTab} onPress={() => setTab(t)}>
              <Text style={[ss.authTabTxt, tab === t ? ss.authTabOn : ss.authTabOff]}>{t === 'signup' ? 'Sign Up' : 'Log In'}</Text>
              {tab === t && <View style={ss.authTabUnder} />}
            </Pressable>
          ))}
        </View>

        {/* Log In */}
        {tab === 'login' && (
          <View style={ss.formGroup}>
            <Text style={ss.authLabel}>Email</Text>
            <TextInput style={ss.authInput} placeholder="you@example.com" placeholderTextColor={JIH.w30} value={loginEmail} onChangeText={setLoginEmail} keyboardType="email-address" autoCapitalize="none" returnKeyType="next" onSubmitEditing={() => loginPwdRef.current?.focus()} />
            <Text style={[ss.authLabel, { marginTop: Spacing.two }]}>Password</Text>
            <PasswordInput placeholder="Password" value={loginPwd} onChangeText={setLoginPwd} returnKeyType="done" onSubmitEditing={handleLogin} inputRef={loginPwdRef} />
            <Pressable onPress={handleLogin} disabled={loading} style={({ pressed }) => [ss.authBtn, { marginTop: Spacing.three, opacity: pressed || loading ? 0.8 : 1 }]}>
              {loading ? <ActivityIndicator color={JIH.navy} /> : <Text style={ss.authBtnTxt}>Log In</Text>}
            </Pressable>
            <Pressable style={ss.authSwitch} onPress={() => Alert.alert('Forgot Password', 'Visit jihwithme.com to reset your password.')}>
              <Text style={ss.authSwitchTxt}>Forgot password?</Text>
            </Pressable>
            <View style={ss.authSwitchRow}><Text style={ss.authSwitchMuted}>Don't have an account? </Text><Pressable onPress={() => setTab('signup')}><Text style={ss.authSwitchTxt}>Sign Up</Text></Pressable></View>
          </View>
        )}

        {/* Sign Up */}
        {tab === 'signup' && (
          <View style={ss.formGroup}>
            <Text style={ss.authLabel}>Full Name</Text>
            <TextInput style={ss.authInput} placeholder="Your full name" placeholderTextColor={JIH.w30} value={fullName} onChangeText={setFullName} autoCapitalize="words" returnKeyType="next" onSubmitEditing={() => emailRef.current?.focus()} />
            <Text style={[ss.authLabel, { marginTop: Spacing.two }]}>Email</Text>
            <TextInput ref={emailRef} style={ss.authInput} placeholder="you@example.com" placeholderTextColor={JIH.w30} value={signEmail} onChangeText={setSignEmail} keyboardType="email-address" autoCapitalize="none" returnKeyType="next" onSubmitEditing={() => phoneRef.current?.focus()} />
            <Text style={[ss.authLabel, { marginTop: Spacing.two }]}>Phone (optional)</Text>
            <View style={ss.phoneRow}><View style={ss.phonePrefix}><Text style={ss.phonePrefixTxt}>+855</Text></View><TextInput ref={phoneRef} style={ss.phoneInput} placeholder="XX XXX XXXX" placeholderTextColor={JIH.w30} value={formatKhMask(phone)} onChangeText={v => setPhone(sanitizeKhDigits(v))} keyboardType="phone-pad" maxLength={12} returnKeyType="next" onSubmitEditing={() => pwdRef.current?.focus()} /></View>
            {phone.length > 0 && !isValidKhPhone(phone) && <Text style={ss.fieldError}>Enter a valid Cambodian phone number</Text>}
            <Text style={[ss.authLabel, { marginTop: Spacing.two }]}>Password</Text>
            <PasswordInput placeholder="Min. 8 characters" value={pwd} onChangeText={setPwd} returnKeyType="next" onSubmitEditing={() => confirmRef.current?.focus()} inputRef={pwdRef} />
            {pwd.length > 0 && (
              <View style={ss.strengthWrap}>
                <View style={ss.strengthBar}>{[0,1,2,3].map(i => <View key={i} style={[ss.strengthSeg, { backgroundColor: i < pwStrength ? STRENGTH_COLOR[pwStrength - 1] : JIH.navyL }]} />)}</View>
                <Text style={[ss.strengthLbl, { color: STRENGTH_COLOR[Math.max(0, pwStrength - 1)] }]}>{STRENGTH_LABEL[pwStrength] ?? ''}</Text>
              </View>
            )}
            <Text style={[ss.authLabel, { marginTop: Spacing.two }]}>Confirm Password</Text>
            <PasswordInput placeholder="Re-enter password" value={confirmPwd} onChangeText={setConfirmPwd} returnKeyType="done" inputRef={confirmRef} />
            {confirmPwd.length > 0 && pwd !== confirmPwd && <Text style={ss.fieldError}>Passwords do not match</Text>}
            <Pressable onPress={() => setAgreed(v => !v)} style={ss.termsRow}>
              <View style={[ss.checkbox, agreed && ss.checkboxOn]}>
                {agreed && <Sym name="checkmark" size={11} color={JIH.navy} />}
              </View>
              <Text style={ss.termsTxt}>I agree to the <Text style={ss.termsLink} onPress={() => Alert.alert('Terms', 'Visit jihwithme.com/terms')}>Terms of Service</Text> and <Text style={ss.termsLink} onPress={() => Alert.alert('Privacy', 'Visit jihwithme.com/privacy')}>Privacy Policy</Text></Text>
            </Pressable>
            <Pressable onPress={handleSignUp} disabled={loading || !agreed} style={({ pressed }) => [ss.authBtn, { marginTop: Spacing.two, opacity: (pressed || loading || !agreed) ? 0.6 : 1 }]}>
              {loading ? <ActivityIndicator color={JIH.navy} /> : <Text style={ss.authBtnTxt}>Create Account</Text>}
            </Pressable>
            <View style={ss.authSwitchRow}><Text style={ss.authSwitchMuted}>Already have an account? </Text><Pressable onPress={() => setTab('login')}><Text style={ss.authSwitchTxt}>Log In</Text></Pressable></View>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ─── Location input card ──────────────────────────────────────────────────────

type FieldType = 'pickup' | 'dest';

function LocationInputCard({ pickupText, destText, onPickupChange, onDestChange, onPickupFocus, onDestFocus, onClearPickup, onClearDest, onGps, gpsLoading, mode }: {
  pickupText: string; destText: string;
  onPickupChange: (v: string) => void; onDestChange: (v: string) => void;
  onPickupFocus: () => void; onDestFocus: () => void;
  onClearPickup: () => void; onClearDest: () => void;
  onGps: () => void; gpsLoading: boolean; mode: BookingMode;
}) {
  const destRef = useRef<TextInput>(null);
  return (
    <View style={ss.locCard}>
      {/* Pickup row */}
      <View style={ss.locRow}>
        <View style={ss.locDotCol}>
          <View style={[ss.locDot, ss.locDotGreen]} />
          {mode !== 'full_day' && <View style={ss.locConnLine} />}
        </View>
        <TextInput style={ss.locInput} placeholder="Pickup location" placeholderTextColor={JIH.w30} value={pickupText} onChangeText={onPickupChange} onFocus={onPickupFocus} returnKeyType={mode !== 'full_day' ? 'next' : 'done'} onSubmitEditing={() => destRef.current?.focus()} />
        <View style={ss.locActions}>
          {gpsLoading
            ? <ActivityIndicator size="small" color={JIH.gold} style={{ width: 28 }} />
            : <Pressable onPress={onGps} hitSlop={10} style={ss.locActionBtn}>
                <Sym name="location.fill" size={16} color={JIH.gold} />
              </Pressable>}
          {pickupText.length > 0 &&
            <Pressable onPress={onClearPickup} hitSlop={10} style={ss.locActionBtn}>
              <Sym name="xmark.circle.fill" size={16} color={JIH.w30} />
            </Pressable>}
        </View>
      </View>

      {/* Destination row */}
      {mode !== 'full_day' && (
        <View style={ss.locRow}>
          <View style={ss.locDotCol}>
            <View style={[ss.locDot, ss.locDotRed]} />
          </View>
          <TextInput ref={destRef} style={ss.locInput} placeholder="Where to?" placeholderTextColor={JIH.w30} value={destText} onChangeText={onDestChange} onFocus={onDestFocus} returnKeyType="done" />
          {destText.length > 0 &&
            <View style={ss.locActions}>
              <Pressable onPress={onClearDest} hitSlop={10} style={ss.locActionBtn}>
                <Sym name="xmark.circle.fill" size={16} color={JIH.w30} />
              </Pressable>
            </View>}
        </View>
      )}
    </View>
  );
}

// ─── Suggestions list ─────────────────────────────────────────────────────────

function SuggestionsList({ query, activeField, onSelect, onGps }: {
  query: string; activeField: FieldType | null;
  onSelect: (l: LocResult) => void; onGps: () => void;
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
          <Pressable style={ss.suggGpsRow} onPress={onGps}>
            <View style={[ss.suggIconWrap, { backgroundColor: `${JIH.gold}22` }]}>
              <Sym name="location.fill" size={14} color={JIH.gold} />
            </View>
            <Text style={ss.suggGpsLabel}>Use current location</Text>
            <Sym name="chevron.right" size={12} color={JIH.w30} />
          </Pressable>
        )}
        <View style={ss.suggSectionRow}>
          <View style={ss.suggSectionLine} />
          <Text style={ss.suggSectionLabel}>Popular places</Text>
          <View style={ss.suggSectionLine} />
        </View>
        {QUICK_SUGGESTIONS.map((p, i) => (
          <Pressable key={i} style={[ss.suggRow, i === QUICK_SUGGESTIONS.length - 1 && { borderBottomWidth: 0 }]} onPress={() => onSelect(p)}>
            <View style={[ss.suggIconWrap, { backgroundColor: JIH.navyL }]}>
              <Sym name="mappin" size={13} color={JIH.w55} />
            </View>
            <View style={ss.suggTextBlock}>
              <Text style={ss.suggName}>{p.name}</Text>
              <Text style={ss.suggAddr} numberOfLines={1}>{p.address}</Text>
            </View>
          </Pressable>
        ))}
      </View>
    );
  }

  if (loading) {
    return (
      <View style={[ss.suggBox, ss.suggLoadRow]}>
        <ActivityIndicator color={JIH.gold} size="small" />
        <Text style={ss.suggLoadTxt}>Searching places…</Text>
      </View>
    );
  }

  if (!items.length) return null;

  return (
    <View style={ss.suggBox}>
      {items.map((item, i) => (
        <Pressable key={i} style={[ss.suggRow, i === items.length - 1 && { borderBottomWidth: 0 }]} onPress={() => onSelect(item)}>
          <View style={[ss.suggIconWrap, { backgroundColor: JIH.navyL }]}>
            <Sym name="mappin" size={13} color={JIH.w55} />
          </View>
          <Text style={ss.suggAddr} numberOfLines={2}>{item.address}</Text>
        </Pressable>
      ))}
    </View>
  );
}

// ─── Vehicle card ─────────────────────────────────────────────────────────────

function VehicleCard({ v, selected, onPress }: { v: (typeof VEHICLES)[number]; selected: boolean; onPress: () => void }) {
  const scale = useSharedValue(1);
  const anim  = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <Animated.View style={anim}>
      <Pressable onPressIn={() => { scale.value = withSpring(0.92); }} onPressOut={() => { scale.value = withSpring(1); }}
        onPress={onPress} style={[ss.vCard, selected && { borderColor: v.color, backgroundColor: `${v.color}12` }]}>
        {/* Accent strip */}
        <View style={[ss.vStrip, { backgroundColor: v.color }]} />
        {/* Icon area */}
        <View style={[ss.vIconWrap, { backgroundColor: selected ? `${v.color}22` : JIH.navyL }]}>
          <Sym name={v.sfIcon} size={22} color={selected ? v.color : JIH.w55} />
        </View>
        <Text style={[ss.vLabel, selected && { color: v.color }]}>{v.label}</Text>
        <Text style={ss.vDesc}>{v.desc}</Text>
        <View style={ss.vPriceRow}>
          <Text style={[ss.vPrice, selected && { color: v.color }]}>${v.baseFare.toFixed(2)}</Text>
          <Text style={ss.vPriceUnit}>+</Text>
        </View>
        <Text style={ss.vSeats}>{v.maxSeats} seat{v.maxSeats > 1 ? 's' : ''}</Text>
      </Pressable>
    </Animated.View>
  );
}

// ─── Payment option ───────────────────────────────────────────────────────────

function PaymentOption({ p, selected, onPress }: { p: (typeof PAYMENTS)[number]; selected: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[ss.pmOpt, selected && { borderColor: p.color, backgroundColor: `${p.color}10` }]}>
      <View style={[ss.pmIconBox, { backgroundColor: selected ? `${p.color}22` : JIH.navyL }]}>
        <Sym name={p.sfIcon} size={18} color={selected ? p.color : JIH.w55} />
      </View>
      <View style={ss.pmInfo}>
        <Text style={[ss.pmLabel, selected && { color: JIH.white }]}>{p.label}</Text>
        <Text style={ss.pmDesc}>{p.desc}</Text>
      </View>
      <View style={[ss.radio, selected && { borderColor: p.color, backgroundColor: p.color }]}>
        {selected && <Sym name="checkmark" size={9} color={JIH.white} />}
      </View>
    </Pressable>
  );
}

// ─── Ride card ────────────────────────────────────────────────────────────────

function RideCard({ ride, onCancel }: { ride: Booking; onCancel: (id: string) => void }) {
  const canCancel  = ride.status === 'pending' || ride.status === 'scheduled';
  const isLive     = ['matched', 'arrived', 'in_progress'].includes(ride.status);
  const vehicle    = VEHICLES.find(v => v.type === ride.vehicle_type);
  const fareStr    = ride.offered_fare ? `$${ride.offered_fare.toFixed(2)}` : ride.estimated_fare ? `$${ride.estimated_fare.toFixed(2)}` : `$${(vehicle?.baseFare ?? 1).toFixed(2)}+`;
  const dateStr    = ride.scheduled_datetime
    ? `Scheduled · ${new Date(ride.scheduled_datetime).toLocaleDateString()} ${new Date(ride.scheduled_datetime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    : new Date(ride.created_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  const borderColor = STATUS_BORDER[ride.status] ?? JIH.navyXL;
  const scale = useSharedValue(1);
  const anim  = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  // ── Driver location: poll every 5 s + real-time bonus ────────────────────
  const [driverLoc, setDriverLoc] = useState<{ lat: number; lng: number } | null>(null);
  const pollDriverRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!isLive || !ride.driver_id) { setDriverLoc(null); return; }

    const fetchLoc = async () => {
      const { data } = await supabase
        .from('driver_profiles')
        .select('current_lat,current_lng,is_online')
        .eq('user_id', ride.driver_id!)
        .single();
      if (data?.is_online && data.current_lat && data.current_lng) {
        setDriverLoc({ lat: data.current_lat, lng: data.current_lng });
      } else {
        setDriverLoc(null);
      }
    };

    fetchLoc(); // immediate
    // Poll every 5 seconds for smooth driver movement
    pollDriverRef.current = setInterval(fetchLoc, 5_000);

    // Real-time bonus layer
    const ch = supabase.channel(`driver-loc-${ride.driver_id}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'driver_profiles',
        filter: `user_id=eq.${ride.driver_id}`,
      }, (payload) => {
        const p = payload.new as { current_lat?: number | null; current_lng?: number | null; is_online?: boolean };
        if (p.is_online && p.current_lat && p.current_lng) setDriverLoc({ lat: p.current_lat, lng: p.current_lng });
        else setDriverLoc(null);
      })
      .subscribe();

    return () => {
      if (pollDriverRef.current) clearInterval(pollDriverRef.current);
      supabase.removeChannel(ch);
    };
  }, [ride.driver_id, isLive]);


  return (
    <Animated.View style={[anim, ss.rideCard, { borderLeftColor: borderColor }]}>
      {/* Header row */}
      <View style={ss.rideHdr}>
        <StatusPill status={ride.status} />
        <Text style={ss.rideDate}>{dateStr}</Text>
      </View>

      {/* ── "Driver arrived" banner ── */}
      {ride.status === 'arrived' && (
        <View style={ss.arrivedBanner}>
          <View style={ss.arrivedPulse} />
          <View style={{ flex: 1 }}>
            <Text style={ss.arrivedTitle}>Your driver has arrived!</Text>
            <Text style={ss.arrivedSub}>
              {ride.driver_name ? `${ride.driver_name} is waiting outside` : 'Your driver is waiting outside'}
            </Text>
          </View>
          <Sym name="checkmark.seal.fill" size={24} color="#22C55E" />
        </View>
      )}

      {/* ── Live tracking map ── always visible when driver is en-route / arrived */}
      {isLive && (
        <View style={ss.liveMapWrap}>
          <MapView
            style={StyleSheet.absoluteFill}
            // Centre priority: driver → pickup coords → Siem Reap default
            initialRegion={
              driverLoc
                ? { latitude: driverLoc.lat, longitude: driverLoc.lng, latitudeDelta: 0.025, longitudeDelta: 0.025 }
                : ride.pickup_lat && ride.pickup_lng
                ? { latitude: ride.pickup_lat, longitude: ride.pickup_lng, latitudeDelta: 0.04, longitudeDelta: 0.04 }
                : SIEM_REAP
            }
            pitchEnabled={false}
            rotateEnabled={false}
            showsCompass={false}
            showsScale={false}
            showsMyLocationButton={false}>

            {/* Pickup marker */}
            {ride.pickup_lat && ride.pickup_lng && (
              <Marker coordinate={{ latitude: ride.pickup_lat, longitude: ride.pickup_lng }}>
                <View style={ss.markerGreen}><View style={ss.markerInner} /></View>
              </Marker>
            )}
            {/* Destination marker */}
            {ride.destination_lat && ride.destination_lng && (
              <Marker coordinate={{ latitude: ride.destination_lat, longitude: ride.destination_lng }}>
                <View style={ss.markerRed}><View style={ss.markerInner} /></View>
              </Marker>
            )}
            {/* Driver marker — appears when driver broadcasts location */}
            {driverLoc && (
              <Marker
                coordinate={{ latitude: driverLoc.lat, longitude: driverLoc.lng }}
                title={ride.driver_name ?? 'Your driver'}
                tracksViewChanges={false}>
                <View style={ss.markerDriver}>
                  <Text style={ss.driverMarkerIcon}>🚗</Text>
                </View>
              </Marker>
            )}
            {/* Route polyline */}
            {ride.pickup_lat && ride.pickup_lng && ride.destination_lat && ride.destination_lng && (
              <Polyline
                coordinates={[
                  { latitude: ride.pickup_lat, longitude: ride.pickup_lng },
                  { latitude: ride.destination_lat, longitude: ride.destination_lng },
                ]}
                strokeColor={JIH.gold} strokeWidth={2} lineDashPattern={[6, 4]}
              />
            )}
          </MapView>

          {/* Live badge */}
          <View style={ss.liveMapBadge}>
            <View style={ss.liveMapDot} />
            <Text style={ss.liveMapBadgeTxt}>
              {driverLoc
                ? `${ride.driver_name ?? 'Driver'} · Live tracking`
                : ride.status === 'arrived'
                ? 'Driver has arrived'
                : 'Waiting for driver GPS…'}
            </Text>
          </View>
        </View>
      )}

      {/* Route addresses — always shown */}
      <View style={ss.routeRow}>
        <View style={ss.routeDotsCol}>
          <View style={[ss.rdot, { backgroundColor: '#22C55E' }]} />
          <View style={ss.rline} />
          <View style={[ss.rdot, { backgroundColor: '#EF4444' }]} />
        </View>
        <View style={ss.routeAddrs}>
          <Text style={ss.addrPrimary} numberOfLines={1}>{ride.pickup_address}</Text>
          <Text style={ss.addrSec} numberOfLines={1}>
            {ride.destination_address ?? (ride.hire_description ? `Full Day · ${ride.hire_description}` : '—')}
          </Text>
        </View>
        </View>

      {/* Footer: chips + cancel */}
      <View style={ss.rideFooter}>
        <View style={ss.chips}>
          {/* Vehicle chip */}
          {vehicle && (
            <View style={[ss.chip, { borderLeftWidth: 2, borderLeftColor: vehicle.color }]}>
              <Sym name={vehicle.sfIcon} size={11} color={vehicle.color} />
              <Text style={[ss.chipTxt, { color: vehicle.color, marginLeft: 3 }]}>{vehicle.label}</Text>
            </View>
          )}
          {/* Fare chip */}
          <View style={ss.chip}>
            <Sym name="dollarsign.circle" size={11} color={JIH.gold} />
            <Text style={[ss.chipTxt, { marginLeft: 3 }]}>{fareStr}</Text>
          </View>
          {/* Payment chip */}
          {(() => {
            const pm = PAYMENTS.find(p => p.id === ride.payment_method);
            return pm ? (
              <View style={ss.chip}>
                <Sym name={pm.sfIcon} size={11} color={JIH.w55} />
                <Text style={[ss.chipTxt, { marginLeft: 3 }]}>{pm.label}</Text>
              </View>
            ) : null;
          })()}
          {/* Driver chip */}
          {ride.driver_name && (
            <View style={ss.chip}>
              <Sym name="person.fill" size={11} color={JIH.w55} />
              <Text style={[ss.chipTxt, { marginLeft: 3 }]}>{ride.driver_name}</Text>
            </View>
          )}
        </View>
        {canCancel && (
          <Pressable
            onPressIn={() => { scale.value = withSpring(0.96); }}
            onPressOut={() => { scale.value = withSpring(1); }}
            onPress={() => Alert.alert('Cancel Ride', 'Are you sure you want to cancel?', [
              { text: 'Keep ride', style: 'cancel' },
              { text: 'Cancel ride', style: 'destructive', onPress: () => onCancel(ride.id) },
            ])}
            style={ss.cancelBtn}>
            <Sym name="xmark.circle" size={13} color="#EF4444" />
            <Text style={ss.cancelTxt}>Cancel</Text>
          </Pressable>
        )}
      </View>
    </Animated.View>
  );
}

// ─── BookForm ─────────────────────────────────────────────────────────────────

const MAP_H1 = 300; // step 1 — tall map, focus on location
const MAP_H2 = 190; // step 2 — compact map, route visible

// ─── Online driver type ───────────────────────────────────────────────────────

type OnlineDriver = {
  user_id: string;
  current_lat: number | null;
  current_lng: number | null;
  vehicle_type: string | null;
  is_online: boolean | null;
};

// ─── BookForm ─────────────────────────────────────────────────────────────────

function BookForm({ onBooked }: { onBooked: () => void }) {
  const [step,        setStep]        = useState<1 | 2>(1);
  const [mode,        setMode]        = useState<BookingMode>('standard');
  const [pickupLoc,   setPickupLoc]   = useState<LocResult | null>(null);
  const [destLoc,     setDestLoc]     = useState<LocResult | null>(null);
  const [pickupText,  setPickupText]  = useState('');
  const [destText,    setDestText]    = useState('');
  const [activeField, setActiveField] = useState<FieldType | null>(null);
  const [vehicle,     setVehicle]     = useState<VehicleType>('tuktuk');
  const [payment,     setPayment]     = useState<PaymentId>('cash');
  const [groupSize,   setGroupSize]   = useState(1);
  const formInsets = useSafeAreaInsets();
  const mapH     = useSharedValue(MAP_H1);
  const mapAnim  = useAnimatedStyle(() => ({ height: withSpring(mapH.value, { damping: 20, stiffness: 180 }) }));
  const [schedPreset, setSchedPreset] = useState('');
  const [hireDesc,    setHireDesc]    = useState('');
  const [offeredFare, setOfferedFare] = useState('');
  const [gpsLoading,    setGpsLoading]    = useState(false);
  const [loading,       setLoading]       = useState(false);
  const [onlineDrivers, setOnlineDrivers] = useState<OnlineDriver[]>([]);

  // ── Online drivers: poll every 10 s + real-time bonus layer ─────────────
  const pollDriversRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchOnlineDrivers = useCallback(async () => {
    const { data } = await supabase
      .from('driver_profiles')
      .select('user_id,current_lat,current_lng,vehicle_type,is_online')
      .eq('is_online', true);
    if (data) setOnlineDrivers(data.filter(d => d.current_lat && d.current_lng));
  }, []);

  useEffect(() => {
    fetchOnlineDrivers(); // immediate first load

    // Reliable polling every 10 seconds (works even without real-time enabled)
    pollDriversRef.current = setInterval(fetchOnlineDrivers, 10_000);

    // Bonus: real-time for instant updates when table replication is enabled
    const ch = supabase.channel('map-online-drivers')
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'driver_profiles',
      }, (payload) => {
        const d = payload.new as OnlineDriver;
        setOnlineDrivers(prev => {
          const rest = prev.filter(x => x.user_id !== d.user_id);
          if (d.is_online && d.current_lat && d.current_lng) return [...rest, d];
          return rest; // went offline — remove immediately
        });
      })
      .subscribe();

    return () => {
      if (pollDriversRef.current) clearInterval(pollDriversRef.current);
      supabase.removeChannel(ch);
    };
  }, [fetchOnlineDrivers]);
  const mapRef  = useRef<MapView>(null);
  const presets = makePresets();
  const selV    = VEHICLES.find(v => v.type === vehicle)!;

  useEffect(() => {
    if (pickupLoc && destLoc) {
      mapRef.current?.fitToCoordinates(
        [{ latitude: pickupLoc.lat, longitude: pickupLoc.lng }, { latitude: destLoc.lat, longitude: destLoc.lng }],
        { edgePadding: { top: 50, right: 50, bottom: 50, left: 50 }, animated: true },
      );
    } else if (pickupLoc) {
      mapRef.current?.animateToRegion({ latitude: pickupLoc.lat, longitude: pickupLoc.lng, latitudeDelta: 0.03, longitudeDelta: 0.03 }, 500);
    }
  }, [pickupLoc, destLoc]);

  const handleGps = useCallback(async () => {
    setGpsLoading(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') { Alert.alert('Denied', 'Enable location access in Settings.'); return; }
      const pos  = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const addr = await reverseGeocode(pos.coords.latitude, pos.coords.longitude);
      const loc: LocResult = { lat: pos.coords.latitude, lng: pos.coords.longitude, address: addr };
      setPickupLoc(loc); setPickupText(addr); setActiveField(null);
    } catch { Alert.alert('Error', 'Could not get your location.'); }
    finally { setGpsLoading(false); }
  }, []);

  const handleMapPress = useCallback(async (e: { nativeEvent: { coordinate: { latitude: number; longitude: number } } }) => {
    const { latitude, longitude } = e.nativeEvent.coordinate;
    const addr = await reverseGeocode(latitude, longitude);
    const loc: LocResult = { lat: latitude, lng: longitude, address: addr };
    if (!pickupLoc || activeField === 'pickup') { setPickupLoc(loc); setPickupText(addr); setActiveField(null); }
    else { setDestLoc(loc); setDestText(addr); setActiveField(null); }
  }, [pickupLoc, activeField]);

  const handleSelect = useCallback((loc: LocResult) => {
    if (activeField === 'pickup') { setPickupLoc(loc); setPickupText(loc.address); }
    else { setDestLoc(loc); setDestText(loc.address); }
    setActiveField(null);
  }, [activeField]);

  const handleBook = useCallback(async () => {
    if (!pickupText.trim()) { Alert.alert('Missing', 'Please enter a pickup location.'); return; }
    if (mode !== 'full_day' && !destText.trim()) { Alert.alert('Missing', 'Please enter a destination.'); return; }
    if (mode === 'scheduled' && !schedPreset) { Alert.alert('Missing', 'Please choose a departure time.'); return; }
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
        vehicle_type:    vehicle,
        booking_type:    mode === 'full_day' ? 'full_day' : 'standard',
        status:          mode === 'scheduled' ? 'scheduled' : 'pending',
        group_size:      groupSize,
        payment_method:  payment,
        estimated_fare:  mode !== 'full_day' ? selV.baseFare : null,
        offered_fare:    mode === 'full_day' ? parseFloat(offeredFare) : null,
        hire_description:mode === 'full_day' ? (hireDesc.trim() || null) : null,
        scheduled_datetime: mode === 'scheduled' ? schedPreset : null,
      });
      setPickupText(''); setDestText(''); setPickupLoc(null); setDestLoc(null);
      setHireDesc(''); setOfferedFare(''); setSchedPreset('');
      Alert.alert(
        mode === 'full_day' ? 'Full Day Requested' : mode === 'scheduled' ? 'Ride Scheduled' : 'Ride Requested',
        mode === 'full_day' ? 'Your full-day offer has been submitted to drivers.' :
        mode === 'scheduled' ? "Your ride is scheduled. We'll find a driver before departure." :
        "We're finding a driver for you now.",
      );
      onBooked();
    } catch (e) { Alert.alert('Booking failed', e instanceof Error ? e.message : 'Something went wrong.'); }
    finally { setLoading(false); }
  }, [pickupText, destText, pickupLoc, destLoc, vehicle, payment, groupSize, schedPreset, hireDesc, offeredFare, mode, selV, onBooked]);

  const activeQuery  = activeField === 'pickup' ? pickupText : destText;
  const canContinue  = pickupText.trim().length > 0 && (mode === 'full_day' || destText.trim().length > 0);

  const handleContinue = () => {
    if (!pickupText.trim()) { Alert.alert('Missing', 'Enter a pickup location.'); return; }
    if (mode !== 'full_day' && !destText.trim()) { Alert.alert('Missing', 'Enter a destination.'); return; }
    setActiveField(null);
    setStep(2);
    mapH.value = MAP_H2;
  };

  const handleBack = () => {
    setStep(1);
    mapH.value = MAP_H1;
  };

  // ── Shared map block ─────────────────────────────────────────────────────
  const mapBlock = (
    <Animated.View style={[ss.mapWrap, mapAnim]}>
      <MapView ref={mapRef} style={StyleSheet.absoluteFill} initialRegion={SIEM_REAP}
        onPress={step === 1 ? handleMapPress : undefined}
        showsUserLocation showsMyLocationButton={false} showsCompass={false} showsScale={false}>
        {pickupLoc && <Marker coordinate={{ latitude: pickupLoc.lat, longitude: pickupLoc.lng }} title="Pickup"><View style={ss.markerGreen}><View style={ss.markerInner} /></View></Marker>}
        {destLoc   && <Marker coordinate={{ latitude: destLoc.lat,   longitude: destLoc.lng   }} title="Destination"><View style={ss.markerRed}><View style={ss.markerInner} /></View></Marker>}
        {pickupLoc && destLoc && (
          <Polyline coordinates={[{ latitude: pickupLoc.lat, longitude: pickupLoc.lng }, { latitude: destLoc.lat, longitude: destLoc.lng }]}
            strokeColor={JIH.gold} strokeWidth={3} lineDashPattern={[6, 4]} />
        )}
      </MapView>
      {/* hint — pointerEvents="none" so map stays draggable */}
      {step === 1 && !pickupLoc && (
        <View style={ss.mapOverlay} pointerEvents="none">
          <View style={ss.mapHintChip}>
            <Sym name="hand.tap" size={13} color={JIH.w70} />
            <Text style={ss.mapHintTxt}>Tap map to pin pickup</Text>
          </View>
        </View>
      )}
      {step === 1 && pickupLoc && destLoc && (
        <View style={ss.mapOverlay} pointerEvents="none">
          <View style={[ss.mapHintChip, { backgroundColor: `${JIH.gold}22`, borderColor: `${JIH.gold}44` }]}>
            <Sym name="checkmark.circle.fill" size={13} color={JIH.gold} />
            <Text style={[ss.mapHintTxt, { color: JIH.gold }]}>Route ready — tap Continue</Text>
          </View>
        </View>
      )}
    </Animated.View>
  );

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 1 — Location entry (full-screen map + floating panel)
  // ══════════════════════════════════════════════════════════════════════════
  if (step === 1) {
    return (
      <View style={{ flex: 1 }}>

        {/* ── Full-screen map — flex:1 directly on MapView so gesture area is correct ── */}
        <View style={{ flex: 1 }}>
          <MapView
            ref={mapRef}
            style={{ flex: 1 }}          // ← NOT absoluteFill; lets gesture system measure correctly
            initialRegion={SIEM_REAP}
            onPress={handleMapPress}
            showsUserLocation
            showsMyLocationButton={false}
            showsCompass={false}
            showsScale={false}>

            {/* Online driver markers — NO SymbolView inside Marker (causes iOS freeze) */}
            {onlineDrivers.map(driver => {
              const v = VEHICLES.find(x => x.type === driver.vehicle_type);
              // Emoji in plain <Text> is safe inside Markers; SymbolView is not
              const icon = v?.type === 'tuktuk' ? '🛺'
                         : v?.type === 'car'    ? '🚗'
                         : v?.type === 'moto'   ? '🏍'
                         : '🚐';
              return (
                <Marker
                  key={driver.user_id}
                  coordinate={{ latitude: driver.current_lat!, longitude: driver.current_lng! }}
                  title={`${v?.label ?? 'Driver'} available`}
                  tracksViewChanges={false}
                  anchor={{ x: 0.5, y: 0.5 }}>
                  <View style={[ss.driverMarker, { backgroundColor: v?.color ?? JIH.navyM }]}>
                    <Text style={ss.driverMarkerIcon}>{icon}</Text>
                  </View>
                </Marker>
              );
            })}

            {pickupLoc && (
              <Marker coordinate={{ latitude: pickupLoc.lat, longitude: pickupLoc.lng }} title="Pickup">
                <View style={ss.markerGreen}><View style={ss.markerInner} /></View>
              </Marker>
            )}
            {destLoc && (
              <Marker coordinate={{ latitude: destLoc.lat, longitude: destLoc.lng }} title="Destination">
                <View style={ss.markerRed}><View style={ss.markerInner} /></View>
              </Marker>
            )}
            {pickupLoc && destLoc && (
              <Polyline
                coordinates={[{ latitude: pickupLoc.lat, longitude: pickupLoc.lng }, { latitude: destLoc.lat, longitude: destLoc.lng }]}
                strokeColor={JIH.gold} strokeWidth={3} lineDashPattern={[6, 4]} />
            )}
          </MapView>

          {/* Map hints — pointerEvents="none" so they never block map gestures */}
          {!pickupLoc && (
            <View style={ss.mapOverlay} pointerEvents="none">
              <View style={ss.mapHintChip}>
                <Sym name="hand.tap" size={13} color={JIH.w70} />
                <Text style={ss.mapHintTxt}>Tap map to pin pickup</Text>
              </View>
            </View>
          )}
          {pickupLoc && !destLoc && mode !== 'full_day' && (
            <View style={ss.mapOverlay} pointerEvents="none">
              <View style={[ss.mapHintChip, { backgroundColor: `${JIH.gold}22`, borderColor: `${JIH.gold}44` }]}>
                <Sym name="mappin.circle.fill" size={13} color={JIH.gold} />
                <Text style={[ss.mapHintTxt, { color: JIH.gold }]}>Now tap to pin destination</Text>
              </View>
            </View>
          )}
          {pickupLoc && (destLoc || mode === 'full_day') && (
            <View style={ss.mapOverlay} pointerEvents="none">
              <View style={[ss.mapHintChip, { backgroundColor: `${JIH.gold}22`, borderColor: `${JIH.gold}44` }]}>
                <Sym name="checkmark.circle.fill" size={13} color={JIH.gold} />
                <Text style={[ss.mapHintTxt, { color: JIH.gold }]}>Route ready</Text>
              </View>
            </View>
          )}
        </View>

        {/* ── Floating bottom panel ── */}
        <View style={[ss.bottomPanel, { paddingBottom: formInsets.bottom + Spacing.two }]}>
          {/* Drag handle */}
          <View style={ss.panelHandle} />

          {/* Mode selector */}
          <View style={ss.modePillRow}>
            {MODES.map(m => (
              <Pressable key={m.id} onPress={() => { setMode(m.id as BookingMode); setActiveField(null); }}
                style={[ss.modePill, mode === m.id && ss.modePillActive]}>
                <Text style={[ss.modePillTxt, mode === m.id && ss.modePillTxtActive]}>{m.label}</Text>
              </Pressable>
            ))}
          </View>

          {/* Location inputs */}
          <LocationInputCard
            pickupText={pickupText} destText={destText}
            onPickupChange={v => { setPickupText(v); setPickupLoc(null); }}
            onDestChange={v => { setDestText(v); setDestLoc(null); }}
            onPickupFocus={() => setActiveField('pickup')}
            onDestFocus={() => setActiveField('dest')}
            onClearPickup={() => { setPickupLoc(null); setPickupText(''); setActiveField('pickup'); }}
            onClearDest={() => { setDestLoc(null); setDestText(''); setActiveField('dest'); }}
            onGps={handleGps} gpsLoading={gpsLoading} mode={mode} />

          {/* Suggestions list */}
          {activeField && (
            <View style={{ maxHeight: 220 }}>
              <SuggestionsList query={activeQuery} activeField={activeField} onSelect={handleSelect}
                onGps={() => { setActiveField(null); handleGps(); }} />
            </View>
          )}

          {/* Continue button */}
          {!activeField && (
            <Pressable onPress={handleContinue} disabled={!canContinue}
              style={({ pressed }) => [
                ss.continueBtn,
                canContinue ? ss.continueBtnReady : ss.continueBtnDisabled,
                { opacity: pressed ? 0.88 : 1 },
              ]}>
              <View style={ss.bookBtnInner}>
                <Text style={[ss.continueBtnTxt, !canContinue && ss.continueBtnTxtDisabled]}>
                  {canContinue ? 'Choose Ride Options' : 'Enter pickup & destination'}
                </Text>
                {canContinue && <Sym name="chevron.right.circle.fill" size={20} color={JIH.navy} />}
              </View>
            </Pressable>
          )}
        </View>

      </View>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 2 — Ride options
  // ══════════════════════════════════════════════════════════════════════════
  return (
    <View style={{ flex: 1 }}>
      {mapBlock}

      {/* Route summary — tap to go back */}
      <Pressable onPress={handleBack} style={ss.routeSummary}>
        <View style={ss.routeSummaryRoute}>
          <View style={ss.routeSummaryDots}>
            <View style={[ss.rdot, { backgroundColor: '#22C55E' }]} />
            <View style={[ss.rline, { height: 16 }]} />
            <View style={[ss.rdot, { backgroundColor: '#EF4444' }]} />
          </View>
          <View style={{ flex: 1, gap: 6 }}>
            <Text style={ss.routeSummaryAddr} numberOfLines={1}>{pickupText}</Text>
            <Text style={[ss.routeSummaryAddr, { color: JIH.w55 }]} numberOfLines={1}>
              {mode === 'full_day' ? 'Full day hire' : destText}
            </Text>
          </View>
        </View>
        <View style={ss.routeSummaryEdit}>
          <Sym name="pencil.circle" size={18} color={JIH.gold} />
          <Text style={ss.routeSummaryEditTxt}>Edit</Text>
        </View>
      </Pressable>

      {/* Ride options */}
      <ScrollView style={ss.formScroll} contentContainerStyle={ss.formContent}
        keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

        {/* Mode tabs */}
        <GoldTabs tabs={MODES} active={mode} onPress={id => setMode(id as BookingMode)} />

        {/* Scheduled presets */}
        {mode === 'scheduled' && (
          <>
            <Text style={ss.sectionLbl}>Departure time</Text>
            <View style={ss.presetsRow}>
              {presets.map(p => (
                <Pressable key={p.iso} onPress={() => setSchedPreset(p.iso)}
                  style={[ss.preset, schedPreset === p.iso && ss.presetOn]}>
                  <Sym name={schedPreset === p.iso ? 'clock.fill' : 'clock'} size={13}
                    color={schedPreset === p.iso ? JIH.gold : JIH.w55} />
                  <Text style={[ss.presetTxt, schedPreset === p.iso && ss.presetTxtOn]}>{p.label}</Text>
                </Pressable>
              ))}
            </View>
          </>
        )}

        {/* Full day fields */}
        {mode === 'full_day' && (
          <>
            <Text style={ss.sectionLbl}>Trip description</Text>
            <View style={ss.locCard}>
              <TextInput style={[ss.locInput, { paddingVertical: Spacing.two, paddingHorizontal: Spacing.three }]}
                placeholder="Describe your trip (optional)" placeholderTextColor={JIH.w30}
                value={hireDesc} onChangeText={setHireDesc} multiline numberOfLines={2} />
            </View>
            <Text style={ss.sectionLbl}>Offered price (USD)</Text>
            <View style={ss.locCard}>
              <View style={ss.locRow}>
                <View style={ss.locDotCol}><Sym name="dollarsign.circle.fill" size={16} color={JIH.gold} /></View>
                <TextInput style={ss.locInput} placeholder="e.g. 25" placeholderTextColor={JIH.w30}
                  value={offeredFare} onChangeText={setOfferedFare} keyboardType="decimal-pad" />
              </View>
            </View>
          </>
        )}

        {/* Vehicle */}
        <Text style={ss.sectionLbl}>Ride type</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={ss.vScroll}>
          {VEHICLES.map(v => (
            <VehicleCard key={v.type} v={v} selected={vehicle === v.type}
              onPress={() => { setVehicle(v.type); if (groupSize > v.maxSeats) setGroupSize(1); }} />
          ))}
        </ScrollView>

        {/* Group size */}
        {vehicle !== 'moto' && (
          <>
            <Text style={ss.sectionLbl}>Passengers</Text>
            <View style={ss.groupRow}>
              {Array.from({ length: selV.maxSeats }, (_, i) => i + 1).map(n => (
                <Pressable key={n} onPress={() => setGroupSize(n)}
                  style={[ss.groupPill, groupSize === n && { borderColor: selV.color, backgroundColor: `${selV.color}1A` }]}>
                  <Text style={[ss.groupPillTxt, groupSize === n && { color: selV.color }]}>{n}</Text>
                </Pressable>
              ))}
            </View>
          </>
        )}

        {/* Payment */}
        <Text style={ss.sectionLbl}>Payment method</Text>
        <View style={ss.pmList}>
          {PAYMENTS.map(p => <PaymentOption key={p.id} p={p} selected={payment === p.id} onPress={() => setPayment(p.id)} />)}
        </View>

        {/* Fare */}
        {mode !== 'full_day' && (
          <View style={ss.fareRow}>
            <View style={ss.fareLeft}>
              <Sym name="tag.fill" size={14} color={JIH.w55} />
              <Text style={ss.fareLbl}>Estimated fare</Text>
            </View>
            <Text style={ss.fareVal}>From ${selV.baseFare.toFixed(2)}</Text>
          </View>
        )}

        <View style={{ height: 90 }} />
      </ScrollView>

      {/* Book button */}
      <View style={ss.bookBtnWrap}>
        <Pressable onPress={handleBook} disabled={loading}
          style={({ pressed }) => [ss.bookBtn, loading && ss.bookBtnLoading, { opacity: pressed ? 0.88 : 1 }]}>
          {loading ? (
            <ActivityIndicator color={JIH.navy} />
          ) : (
            <View style={ss.bookBtnInner}>
              <View style={[ss.bookBtnVehicleDot, { backgroundColor: selV.color }]} />
              <Text style={ss.bookBtnTxt}>{selV.label} · From ${selV.baseFare.toFixed(2)}</Text>
              <Sym name="arrow.right.circle.fill" size={20} color={JIH.navy} />
            </View>
          )}
        </Pressable>
      </View>
    </View>
  );
}

// ─── MyRides ──────────────────────────────────────────────────────────────────

type HistSection = 'upcoming' | 'scheduled' | 'past';
const HIST_SECTIONS: { id: HistSection; label: string }[] = [
  { id: 'upcoming', label: 'Upcoming' }, { id: 'scheduled', label: 'Scheduled' }, { id: 'past', label: 'Past' },
];
const ACTIVE_S = ['pending', 'matched', 'arrived', 'in_progress'];

function MyRides({ refresh, userId }: { refresh: number; userId: string }) {
  const [section, setSection] = useState<HistSection>('upcoming');
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

  // Real-time: update ride status + driver info when Supabase pushes changes
  useEffect(() => {
    const ch = supabase.channel(`my-rides-${userId}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'rides',
        filter: `passenger_id=eq.${userId}`,
      }, (payload) => {
        setRides(prev => prev.map(r =>
          r.id === (payload.new as Booking).id ? { ...r, ...(payload.new as Booking) } : r,
        ));
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [userId]);

  const handleCancel = useCallback(async (id: string) => {
    try { await apiCancel(id); await load(); }
    catch (e) { Alert.alert('Error', e instanceof Error ? e.message : 'Failed to cancel'); }
  }, [load]);

  const upcoming  = rides.filter(r => ACTIVE_S.includes(r.status));
  const scheduled = rides.filter(r => r.status === 'scheduled');
  const past      = rides.filter(r => !ACTIVE_S.includes(r.status) && r.status !== 'scheduled');
  const shown     = section === 'upcoming' ? upcoming : section === 'scheduled' ? scheduled : past;
  const completed = past.filter(r => r.status === 'completed');
  const spent     = completed.reduce((s, r) => s + (r.offered_fare ?? r.estimated_fare ?? 0), 0);

  return (
    <>
      <GoldTabs tabs={HIST_SECTIONS} active={section} onPress={id => setSection(id as HistSection)} />
      {loading ? (
        <View style={ss.stateWrap}><ActivityIndicator color={JIH.gold} size="large" /><Text style={ss.stateTxt}>Loading rides…</Text></View>
      ) : error ? (
        <View style={ss.stateWrap}>
          <View style={[ss.stateIcon, { backgroundColor: '#FEE2E2' }]}><Sym name="exclamationmark.triangle.fill" size={28} color="#EF4444" /></View>
          <Text style={ss.stateTitle}>Something went wrong</Text>
          <Text style={ss.stateTxt}>{error}</Text>
          <Pressable onPress={load} style={ss.retryBtn}><Text style={ss.retryTxt}>Try again</Text></Pressable>
        </View>
      ) : (
        <ScrollView style={ss.ridesScroll} contentContainerStyle={ss.ridesContent} showsVerticalScrollIndicator={false}>
          {section === 'past' && completed.length > 0 && (
            <View style={ss.summCard}>
              <Text style={ss.summTitle}>This month</Text>
              <View style={ss.summRow}>
                {[['Rides', String(completed.length)], ['Total spent', `$${spent.toFixed(2)}`], ['Avg fare', `$${completed.length ? (spent / completed.length).toFixed(2) : '0.00'}`]].map(([l, v], i) => (
                  <View key={i} style={ss.summItem}><Text style={ss.summVal}>{v}</Text><Text style={ss.summLbl}>{l}</Text></View>
                ))}
              </View>
            </View>
          )}
          {shown.length === 0 ? (
            <View style={ss.stateWrap}>
              <View style={[ss.stateIcon, { backgroundColor: `${JIH.gold}15` }]}>
                <Sym name={section === 'past' ? 'clock.arrow.circlepath' : 'map'} size={28} color={JIH.gold} />
              </View>
              <Text style={ss.stateTitle}>{section === 'upcoming' ? 'No active rides' : section === 'scheduled' ? 'No scheduled rides' : 'No past rides'}</Text>
              <Text style={ss.stateTxt}>{section === 'past' ? 'Your ride history will appear here.' : 'Book a ride to get started.'}</Text>
            </View>
          ) : shown.map(r => <RideCard key={r.id} ride={r} onCancel={handleCancel} />)}
        </ScrollView>
      )}
    </>
  );
}

// ─── Main BookingScreen ───────────────────────────────────────────────────────

type MainTab = 'book' | 'rides';
const MAIN_TABS: { id: MainTab; label: string }[] = [
  { id: 'book', label: 'Book a Ride' }, { id: 'rides', label: 'My Rides' },
];

export default function BookingScreen() {
  const insets                = useSafeAreaInsets();
  const [tab, setTab]         = useState<MainTab>('book');
  const [refresh, setRefresh] = useState(0);
  const [userId, setUserId]   = useState<string | null>(null);
  const [authLoading, setAuthL] = useState(true);


  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => { setUserId(session?.user?.id ?? null); setAuthL(false); });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setUserId(s?.user?.id ?? null));
    return () => subscription.unsubscribe();
  }, []);

  if (authLoading) {
    return <View style={[ss.screen, { justifyContent: 'center', alignItems: 'center', paddingTop: insets.top }]}><ActivityIndicator color={JIH.gold} size="large" /></View>;
  }

  if (!userId) {
    return <SignInScreen onSignedIn={() => supabase.auth.getUser().then(({ data: { user } }) => setUserId(user?.id ?? null))} />;
  }

  return (
    <KeyboardAvoidingView style={[ss.screen, { paddingTop: insets.top }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {/* ── Header ── */}
      <View style={ss.header}>
        <View style={ss.headerLeft}>
          <View style={ss.logoMark}><Text style={ss.logoMarkTxt}>JIH</Text></View>
          <View>
            <Text style={ss.hTitle}>JihWolrd</Text>
            <Text style={ss.hGold}>Rides · Siem Reap</Text>
          </View>
        </View>
        <Pressable onPress={() => supabase.auth.signOut()} style={ss.signOutBtn}>
          <Sym name="rectangle.portrait.and.arrow.right" size={14} color={JIH.w55} />
          <Text style={ss.signOutTxt}>Sign out</Text>
        </Pressable>
      </View>

      {/* ── Main tab bar — segmented control ── */}
      <View style={ss.segControl}>
        {MAIN_TABS.map(t => {
          const on = tab === t.id;
          return (
            <Pressable
              key={t.id}
              style={[ss.segTab, { backgroundColor: on ? JIH.gold : 'transparent' }]}
              onPress={() => setTab(t.id)}>
              <Text style={[ss.segTabTxt, { color: on ? JIH.navy : JIH.w55, fontWeight: on ? '700' : '600' }]}>
                {t.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* ── Content ── */}
      <View style={[ss.content, { paddingBottom: insets.bottom + BottomTabInset }]}>
        {tab === 'book'
          ? <BookForm onBooked={() => { setRefresh(n => n + 1); setTab('rides'); }} />
          : <MyRides refresh={refresh} userId={userId} />}
      </View>
    </KeyboardAvoidingView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const ss = StyleSheet.create({
  screen:  { flex: 1, backgroundColor: JIH.navy },
  content: { flex: 1 },

  // Auth
  authScreen:       { flex: 1, backgroundColor: JIH.navy },
  authScroll:       { flexGrow: 1, justifyContent: 'center', padding: Spacing.four, gap: Spacing.three },
  authLogo:         { alignItems: 'center', gap: Spacing.two, marginBottom: Spacing.one },
  authIconCircle:   { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
  authLogoMark:     { width: 64, height: 64, borderRadius: 16, backgroundColor: JIH.gold, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  authLogoTxt:      { color: JIH.navy, fontSize: 20, fontWeight: '900', letterSpacing: 2 },
  authTitle:        { color: JIH.white, fontSize: 24, fontWeight: '700', letterSpacing: -0.5 },
  authSub:          { color: JIH.w55, fontSize: 14 },
  authLabel:        { color: JIH.w55, fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 5 },
  authInput:        { backgroundColor: JIH.navyL, borderRadius: 10, borderWidth: 1, borderColor: JIH.navyXL, color: JIH.white, fontSize: 15, paddingHorizontal: Spacing.three, paddingVertical: 11 },
  authBtn:          { backgroundColor: JIH.gold, borderRadius: 14, paddingVertical: 14, alignItems: 'center', shadowColor: JIH.gold, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.3, shadowRadius: 12, elevation: 8 },
  authBtnTxt:       { color: JIH.navy, fontSize: 16, fontWeight: '700' },
  authBtnOutline:   { borderWidth: 1.5, borderColor: JIH.gold, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  authBtnOutlineTxt:{ color: JIH.gold, fontSize: 15, fontWeight: '600' },
  authSwitch:       { alignItems: 'center', paddingVertical: Spacing.two },
  authSwitchTxt:    { color: JIH.gold, fontSize: 14 },
  authSwitchRow:    { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', paddingTop: Spacing.two },
  authSwitchMuted:  { color: JIH.w55, fontSize: 14 },
  formGroup:        { gap: Spacing.two },
  oauthBtn:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, borderWidth: 1.5, borderColor: JIH.navyXL, borderRadius: 12, paddingVertical: 12, backgroundColor: JIH.navyM },
  oauthBtnApple:    { backgroundColor: JIH.white },
  oauthDot:         { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  oauthDotTxt:      { color: JIH.white, fontSize: 13, fontWeight: '800' },
  oauthTxt:         { color: JIH.white, fontSize: 15, fontWeight: '600' },
  orRow:            { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  orLine:           { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: JIH.navyXL },
  orTxt:            { color: JIH.w30, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.8 },
  authTabBar:       { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: JIH.navyXL },
  authTab:          { flex: 1, alignItems: 'center', paddingBottom: 8, paddingTop: 4, position: 'relative' },
  authTabTxt:       { fontSize: 14, fontWeight: '600' },
  authTabOn:        { color: JIH.gold },
  authTabOff:       { color: JIH.w55 },
  authTabUnder:     { position: 'absolute', bottom: 0, left: 0, right: 0, height: 2, backgroundColor: JIH.gold, borderRadius: 1 },
  pwdRow:           { flexDirection: 'row', alignItems: 'center', backgroundColor: JIH.navyL, borderRadius: 10, borderWidth: 1, borderColor: JIH.navyXL, paddingRight: Spacing.two },
  pwdInput:         { flex: 1, color: JIH.white, fontSize: 15, paddingHorizontal: Spacing.three, paddingVertical: 11 },
  pwdEye:           { padding: 6 },
  strengthWrap:     { marginTop: 6, gap: 4 },
  strengthBar:      { flexDirection: 'row', gap: 3 },
  strengthSeg:      { flex: 1, height: 4, borderRadius: 2 },
  strengthLbl:      { fontSize: 11, fontWeight: '600' },
  phoneRow:         { flexDirection: 'row', borderRadius: 10, borderWidth: 1, borderColor: JIH.navyXL, overflow: 'hidden' },
  phonePrefix:      { backgroundColor: JIH.navyL, paddingHorizontal: Spacing.three, justifyContent: 'center', borderRightWidth: 1, borderRightColor: JIH.navyXL },
  phonePrefixTxt:   { color: JIH.w55, fontSize: 14, fontWeight: '600' },
  phoneInput:       { flex: 1, backgroundColor: JIH.navyL, color: JIH.white, fontSize: 15, paddingHorizontal: Spacing.three, paddingVertical: 11 },
  fieldError:       { color: '#EF4444', fontSize: 11, marginTop: 3 },
  termsRow:         { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two, paddingTop: Spacing.one },
  checkbox:         { width: 20, height: 20, borderRadius: 5, borderWidth: 2, borderColor: JIH.navyXL, backgroundColor: JIH.navyL, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  checkboxOn:       { borderColor: JIH.gold, backgroundColor: JIH.gold },
  termsTxt:         { flex: 1, color: JIH.w55, fontSize: 13, lineHeight: 19 },
  termsLink:        { color: JIH.gold },

  // Header
  header:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.four, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: JIH.navyXL },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  logoMark:   { width: 34, height: 34, borderRadius: 9, backgroundColor: JIH.gold, alignItems: 'center', justifyContent: 'center' },
  logoMarkTxt:{ color: JIH.navy, fontSize: 11, fontWeight: '900', letterSpacing: 1 },
  hTitle:     { color: JIH.white, fontSize: 16, fontWeight: '700', letterSpacing: -0.3 },
  hGold:      { color: JIH.gold, fontSize: 11, fontWeight: '500' },
  signOutBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: JIH.navyXL },
  signOutTxt: { color: JIH.w55, fontSize: 12, fontWeight: '500' },

  // Segmented control (main "Book a Ride / My Rides" switcher)
  segControl:   {
    flexDirection: 'row',
    marginHorizontal: Spacing.three,
    marginVertical: Spacing.two,
    backgroundColor: JIH.navyM,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: JIH.navyXL,
    padding: 3,
    gap: 3,
  },
  segTab:       { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 9, borderRadius: 11 },
  segTabActive: { backgroundColor: JIH.gold },
  segTabTxt:    { fontSize: 14, fontWeight: '600', color: JIH.w55 },
  segTabTxtOn:  { color: JIH.navy, fontWeight: '700' },

  // Mode bar (Standard / Scheduled / Full Day  +  Upcoming / Scheduled / Past)
  modebar:     { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: JIH.navyXL },
  modeBtn:     { flex: 1, alignItems: 'center', paddingVertical: 10, position: 'relative' },
  modeTxt:     { fontSize: 13, fontWeight: '600' },
  modeTxtOn:   { color: JIH.gold },
  modeTxtOff:  { color: JIH.w55 },
  modeUnder:   { position: 'absolute', bottom: 0, left: 0, right: 0, height: 2, borderRadius: 1 },
  modeUnderOn: { backgroundColor: JIH.gold },
  modeUnderOff:{ backgroundColor: 'transparent' },

  // Map
  mapWrap:      { width: '100%', overflow: 'hidden' },
  mapOverlay:   { position: 'absolute', bottom: 12, left: 0, right: 0, alignItems: 'center' },
  mapHintChip:  { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.15)' },
  mapHintTxt:   { color: JIH.w70, fontSize: 12, fontWeight: '500' },

  // Custom map markers
  markerGreen:  { width: 24, height: 24, borderRadius: 12, backgroundColor: '#22C55E', borderWidth: 3, borderColor: JIH.white, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 3, elevation: 4 },
  markerRed:    { width: 24, height: 24, borderRadius: 12, backgroundColor: '#EF4444', borderWidth: 3, borderColor: JIH.white, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 3, elevation: 4 },
  markerInner:  { width: 6, height: 6, borderRadius: 3, backgroundColor: JIH.white },
  driverMarker:     { width: 32, height: 32, borderRadius: 9, alignItems: 'center', justifyContent: 'center', borderWidth: 2.5, borderColor: JIH.white, shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.35, shadowRadius: 5, elevation: 6 },
  driverMarkerIcon: { fontSize: 16, lineHeight: 20 },

  // Location card (floating)
  locWrap:     { paddingHorizontal: Spacing.three, paddingTop: Spacing.two },
  locCard:     { backgroundColor: JIH.navyM, borderRadius: 16, borderWidth: 1, borderColor: JIH.navyXL, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 8, elevation: 6 },
  locRow:      { flexDirection: 'row', alignItems: 'center', minHeight: 44 },
  locDotCol:   { width: 40, alignItems: 'center', justifyContent: 'flex-start', paddingTop: 14, alignSelf: 'stretch' },
  locDot:      { width: 12, height: 12, borderRadius: 6, marginTop: 2 },
  locDotGreen: { backgroundColor: '#22C55E' },
  locDotRed:   { backgroundColor: '#EF4444' },
  locConnLine: { width: 2, flex: 1, backgroundColor: JIH.navyXL, marginTop: 3, marginBottom: 0, borderRadius: 1 },
  locInput:    { flex: 1, color: JIH.white, fontSize: 14, fontWeight: '500', paddingVertical: 12, paddingRight: 8 },
  locActions:  { flexDirection: 'row', alignItems: 'center', paddingRight: 12, gap: 6 },
  locActionBtn:{ padding: 4 },

  // Suggestions
  suggBox:        { backgroundColor: JIH.navyM, borderRadius: 14, borderWidth: 1, borderColor: JIH.navyXL, marginTop: 4, overflow: 'hidden', maxHeight: 280, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 8, elevation: 5 },
  suggGpsRow:     { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: JIH.navyXL, gap: 10 },
  suggIconWrap:   { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  suggGpsLabel:   { flex: 1, color: JIH.gold, fontSize: 14, fontWeight: '600' },
  suggSectionRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 6, gap: 8 },
  suggSectionLine:{ flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: JIH.navyXL },
  suggSectionLabel:{ color: JIH.w30, fontSize: 10, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.8 },
  suggRow:        { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: JIH.navyXL, gap: 10 },
  suggTextBlock:  { flex: 1 },
  suggName:       { color: JIH.white, fontSize: 13, fontWeight: '600' },
  suggAddr:       { color: JIH.w55, fontSize: 12, flex: 1 },
  suggLoadRow:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 16, gap: 8 },
  suggLoadTxt:    { color: JIH.w55, fontSize: 13 },

  // Section labels
  sectionLbl:  { color: JIH.w55, fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1, marginTop: Spacing.two },
  formScroll:  { flex: 1 },
  formContent: { paddingHorizontal: Spacing.three, paddingTop: Spacing.two, gap: Spacing.two, paddingBottom: 100 },

  // Scheduled presets
  presetsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  preset:     { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, borderWidth: 1.5, borderColor: JIH.navyXL, backgroundColor: JIH.navyM },
  presetOn:   { borderColor: JIH.gold, backgroundColor: `${JIH.gold}18` },
  presetTxt:  { color: JIH.w55, fontSize: 13, fontWeight: '500' },
  presetTxtOn:{ color: JIH.gold },

  // Vehicle cards
  vScroll:   { gap: Spacing.two, paddingVertical: 4 },
  vCard:     { width: 90, borderRadius: 14, borderWidth: 1.5, borderColor: JIH.navyXL, backgroundColor: JIH.navyM, overflow: 'hidden', gap: 0 },
  vStrip:    { height: 4, width: '100%' },
  vIconWrap: { marginHorizontal: 10, marginTop: 10, marginBottom: 6, width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  vLabel:    { paddingHorizontal: 10, color: JIH.w70, fontSize: 12, fontWeight: '700' },
  vDesc:     { paddingHorizontal: 10, color: JIH.w30, fontSize: 10, marginTop: 1 },
  vPriceRow: { paddingHorizontal: 10, marginTop: 6, flexDirection: 'row', alignItems: 'baseline', gap: 1 },
  vPrice:    { color: JIH.w55, fontSize: 13, fontWeight: '700' },
  vPriceUnit:{ color: JIH.w30, fontSize: 11 },
  vSeats:    { paddingHorizontal: 10, paddingBottom: 10, color: JIH.w30, fontSize: 10, marginTop: 2 },

  // Group size
  groupRow:     { flexDirection: 'row', gap: Spacing.two },
  groupPill:    { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: JIH.navyM, borderWidth: 1.5, borderColor: JIH.navyXL },
  groupPillTxt: { color: JIH.w55, fontSize: 15, fontWeight: '700' },

  // Payment
  pmList:   { gap: Spacing.two },
  pmOpt:    { flexDirection: 'row', alignItems: 'center', backgroundColor: JIH.navyM, borderRadius: 14, borderWidth: 1.5, borderColor: JIH.navyXL, padding: 12, gap: 12 },
  pmIconBox:{ width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  pmInfo:   { flex: 1 },
  pmLabel:  { color: JIH.w70, fontSize: 14, fontWeight: '600' },
  pmDesc:   { color: JIH.w30, fontSize: 11, marginTop: 1 },
  radio:    { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: JIH.w30, alignItems: 'center', justifyContent: 'center' },

  // Fare row
  fareRow:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: JIH.navyM, borderRadius: 12, padding: Spacing.three, borderWidth: 1, borderColor: JIH.navyXL },
  fareLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  fareLbl:  { color: JIH.w55, fontSize: 14 },
  fareVal:  { color: JIH.gold, fontSize: 20, fontWeight: '700' },

  // Step 1 — floating bottom panel
  bottomPanel: {
    backgroundColor: JIH.navyM,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.one,
    paddingBottom: Spacing.three,
    gap: Spacing.two,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.28,
    shadowRadius: 14,
    elevation: 12,
  },
  panelHandle: {
    width: 44, height: 4, borderRadius: 2,
    backgroundColor: JIH.navyXL,
    alignSelf: 'center',
    marginBottom: Spacing.one,
  },

  // Step 1 — continue button variants
  continueBtn:          { borderRadius: 16, paddingVertical: 14, alignItems: 'center', justifyContent: 'center' },
  continueBtnReady:     { backgroundColor: JIH.gold, shadowColor: JIH.gold, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.35, shadowRadius: 12, elevation: 8 },
  continueBtnDisabled:  { backgroundColor: JIH.navyL, borderWidth: 1, borderColor: JIH.navyXL },
  continueBtnTxt:       { color: JIH.navy, fontSize: 16, fontWeight: '700', flex: 1, textAlign: 'center' },
  continueBtnTxtDisabled: { color: JIH.w30 },

  // Step 1 — mode pills
  modePillRow:       { flexDirection: 'row', gap: Spacing.two },
  modePill:          { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1.5, borderColor: JIH.navyXL, backgroundColor: JIH.navyM },
  modePillActive:    { borderColor: JIH.gold, backgroundColor: `${JIH.gold}18` },
  modePillTxt:       { color: JIH.w55, fontSize: 13, fontWeight: '600' },
  modePillTxtActive: { color: JIH.gold },

  // Step 2 — route summary bar
  routeSummary:        { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.three, paddingVertical: 10, backgroundColor: JIH.navyM, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: JIH.navyXL, gap: 12 },
  routeSummaryRoute:   { flex: 1, flexDirection: 'row', gap: 10, alignItems: 'center' },
  routeSummaryDots:    { alignItems: 'center', gap: 2 },
  routeSummaryAddr:    { color: JIH.white, fontSize: 13, fontWeight: '500' },
  routeSummaryEdit:    { flexDirection: 'row', alignItems: 'center', gap: 4, paddingLeft: 8 },
  routeSummaryEditTxt: { color: JIH.gold, fontSize: 13, fontWeight: '600' },

  // Book button
  bookBtnWrap:       { position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: Spacing.three, paddingBottom: Spacing.two, paddingTop: Spacing.one, backgroundColor: JIH.navy, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: JIH.navyXL },
  bookBtn:           { backgroundColor: JIH.gold, borderRadius: 16, paddingVertical: 14, alignItems: 'center', justifyContent: 'center', shadowColor: JIH.gold, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.35, shadowRadius: 14, elevation: 8 },
  bookBtnDisabled:   { backgroundColor: JIH.navyM, shadowOpacity: 0 },
  bookBtnLoading:    { opacity: 0.7 },
  bookBtnInner:      { flexDirection: 'row', alignItems: 'center', gap: 8 },
  bookBtnVehicleDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: JIH.navy, opacity: 0.5 },
  bookBtnTxt:        { color: JIH.navy, fontSize: 16, fontWeight: '700', flex: 1, textAlign: 'center' },

  // My Rides
  ridesScroll:  { flex: 1 },
  ridesContent: { padding: Spacing.three, gap: Spacing.three, paddingBottom: Spacing.six },
  summCard:     { backgroundColor: JIH.navyM, borderRadius: 16, padding: Spacing.three, borderWidth: 1, borderColor: JIH.navyXL },
  summTitle:    { color: JIH.gold, fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 },
  summRow:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around' },
  summItem:     { alignItems: 'center', gap: 3 },
  summVal:      { color: JIH.white, fontSize: 20, fontWeight: '700' },
  summLbl:      { color: JIH.w55, fontSize: 11 },

  // Ride card
  rideCard:     { backgroundColor: JIH.navyM, borderRadius: 16, borderWidth: 1, borderColor: JIH.navyXL, borderLeftWidth: 4, padding: Spacing.three, gap: Spacing.two, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.12, shadowRadius: 6, elevation: 3 },

  // Live tracking map inside ride card
  // "Driver arrived" banner
  arrivedBanner: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#D1FAE5', borderRadius: 12, padding: Spacing.two + 2 },
  arrivedPulse:  { width: 12, height: 12, borderRadius: 6, backgroundColor: '#22C55E' },
  arrivedTitle:  { color: '#065F46', fontSize: 14, fontWeight: '700' },
  arrivedSub:    { color: '#047857', fontSize: 12, marginTop: 1 },

  liveMapWrap:     { height: 160, borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: JIH.navyXL },
  markerDriver:    { width: 30, height: 30, borderRadius: 15, backgroundColor: '#3B82F6', borderWidth: 3, borderColor: JIH.white, alignItems: 'center', justifyContent: 'center', shadowColor: '#3B82F6', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.5, shadowRadius: 6, elevation: 6 },
  liveMapBadge:    { position: 'absolute', bottom: 8, left: 8, flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(17,30,44,0.85)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  liveMapDot:      { width: 7, height: 7, borderRadius: 3.5, backgroundColor: '#22C55E' },
  liveMapBadgeTxt: { color: JIH.white, fontSize: 12, fontWeight: '600' },
  rideHdr:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rideDate:     { color: JIH.w30, fontSize: 11 },
  routeRow:     { flexDirection: 'row', alignItems: 'stretch', gap: 10 },
  routeDotsCol: { alignItems: 'center', paddingTop: 3, gap: 0 },
  rdot:         { width: 10, height: 10, borderRadius: 5 },
  rline:        { width: 2, flex: 1, backgroundColor: JIH.navyXL, borderRadius: 1, marginVertical: 3 },
  routeAddrs:   { flex: 1, gap: 8 },
  addrPrimary:  { color: JIH.white, fontSize: 14, fontWeight: '500' },
  addrSec:      { color: JIH.w55, fontSize: 13 },
  rideFooter:   { gap: Spacing.two },
  chips:        { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip:         { flexDirection: 'row', alignItems: 'center', backgroundColor: JIH.navyL, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  chipTxt:      { color: JIH.w55, fontSize: 12, fontWeight: '500' },
  cancelBtn:    { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-end', gap: 5, backgroundColor: '#FEE2E2', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  cancelTxt:    { color: '#EF4444', fontSize: 12, fontWeight: '700' },

  // Status pill
  pill:    { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  pillTxt: { fontSize: 11, fontWeight: '700' },

  // States
  stateWrap:  { alignItems: 'center', justifyContent: 'center', paddingVertical: 48, gap: 12 },
  stateIcon:  { width: 72, height: 72, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  stateTitle: { color: JIH.white, fontSize: 17, fontWeight: '700' },
  stateTxt:   { color: JIH.w55, fontSize: 14, textAlign: 'center', paddingHorizontal: Spacing.four },
  retryBtn:   { backgroundColor: JIH.gold, paddingHorizontal: Spacing.four, paddingVertical: 10, borderRadius: 12, marginTop: 4 },
  retryTxt:   { color: JIH.navy, fontWeight: '700', fontSize: 14 },
});
