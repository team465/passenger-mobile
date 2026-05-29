/**
 * Passenger profile screen
 * Shows wallet balance, ride stats, editable name/phone, and account settings.
 */
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomTabInset, Spacing } from '@/constants/theme';
import { supabase } from '@/lib/supabase';

// ─── Design tokens ────────────────────────────────────────────────────────────

const JIH = {
  navy: '#111E2C', navyM: '#1B2A3B', navyL: '#253548', navyXL: '#2F4258',
  gold: '#E8A020', goldL: '#F5B83A',
  white: '#FFFFFF',
  w70: 'rgba(255,255,255,0.70)', w55: 'rgba(255,255,255,0.55)',
  w30: 'rgba(255,255,255,0.30)',
} as const;

function Sym({ name, size = 18, color = JIH.white }: { name: string; size?: number; color?: string }) {
  if (Platform.OS === 'ios') {
    return (
      <SymbolView
        name={name as Parameters<typeof SymbolView>[0]['name']}
        size={size}
        tintColor={color}
        style={{ width: size, height: size }}
      />
    );
  }
  return <View style={{ width: size, height: size, borderRadius: 3, backgroundColor: color, opacity: 0.8 }} />;
}

// ─── Cambodian phone utils ────────────────────────────────────────────────────

const sanitizeKhDigits = (raw: string) => { const d = (raw ?? '').replace(/\D/g, ''); return d.startsWith('0') ? d.slice(1) : d; };
const formatKhMask = (d: string) => { const s = sanitizeKhDigits(d); if (s.length <= 2) return s; if (s.length <= 5) return `${s.slice(0, 2)} ${s.slice(2)}`; return `${s.slice(0, 2)} ${s.slice(2, 5)} ${s.slice(5, 12)}`; };
const composeKhPhone = (d: string) => { const s = sanitizeKhDigits(d); return s ? `+855${s}` : ''; };
const isValidKhPhone = (d: string) => { const s = sanitizeKhDigits(d); return s.length >= 8 && s.length <= 9; };
const displayPhone = (p: string | null) => {
  if (!p) return '';
  const local = p.startsWith('+855') ? p.slice(4) : p;
  return formatKhMask(local);
};

// ─── Types ────────────────────────────────────────────────────────────────────

type Profile = {
  full_name: string | null;
  phone: string | null;
  email: string | null;
  wallet_balance: number;
  created_at: string | null;
};

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({ label, value, icon }: { label: string; value: string; icon: string }) {
  return (
    <View style={ps.statCard}>
      <Sym name={icon} size={20} color={JIH.gold} />
      <Text style={ps.statValue}>{value}</Text>
      <Text style={ps.statLabel}>{label}</Text>
    </View>
  );
}

// ─── Info row ─────────────────────────────────────────────────────────────────

function InfoRow({
  icon, label, value, editable, onEdit,
}: { icon: string; label: string; value: string; editable?: boolean; onEdit?: () => void }) {
  return (
    <View style={ps.infoRow}>
      <View style={ps.infoIconBox}><Sym name={icon} size={16} color={JIH.gold} /></View>
      <View style={ps.infoText}>
        <Text style={ps.infoLabel}>{label}</Text>
        <Text style={ps.infoValue}>{value || '—'}</Text>
      </View>
      {editable && onEdit && (
        <Pressable onPress={onEdit} style={ps.infoEditBtn} hitSlop={8}>
          <Sym name="pencil" size={14} color={JIH.w55} />
        </Pressable>
      )}
    </View>
  );
}

// ─── Not signed in prompt ─────────────────────────────────────────────────────

function SignInPrompt({ insets }: { insets: ReturnType<typeof useSafeAreaInsets> }) {
  return (
    <View style={[ps.screen, { paddingTop: insets.top, justifyContent: 'center', alignItems: 'center', gap: Spacing.three }]}>
      <View style={ps.avatarCircle}>
        <Sym name="person.fill" size={40} color={JIH.w55} />
      </View>
      <Text style={[ps.sectionTitle, { textAlign: 'center' }]}>Sign in to view your profile</Text>
      <Text style={[ps.infoLabel, { textAlign: 'center', paddingHorizontal: Spacing.four }]}>
        Sign in via the Book tab to manage your account.
      </Text>
    </View>
  );
}

// ─── Edit modal (inline) ──────────────────────────────────────────────────────

function EditSheet({
  field, current, onSave, onCancel,
}: { field: 'name' | 'phone'; current: string; onSave: (v: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(
    field === 'phone' ? displayPhone(current) : current,
  );

  const handleSave = () => {
    if (field === 'name' && !value.trim()) { Alert.alert('Required', 'Name cannot be empty.'); return; }
    if (field === 'phone' && value && !isValidKhPhone(value)) { Alert.alert('Invalid', 'Enter a valid Cambodian phone number.'); return; }
    onSave(field === 'phone' ? (value ? composeKhPhone(value) : '') : value.trim());
  };

  return (
    <View style={ps.editSheet}>
      <View style={ps.editSheetHandle} />
      <Text style={ps.editSheetTitle}>{field === 'name' ? 'Edit Name' : 'Edit Phone'}</Text>

      {field === 'phone' ? (
        <View style={ps.phoneRow}>
          <View style={ps.phonePrefix}><Text style={ps.phonePrefixTxt}>+855</Text></View>
          <TextInput
            style={ps.phoneInput}
            placeholder="XX XXX XXXX"
            placeholderTextColor={JIH.w30}
            value={formatKhMask(value)}
            onChangeText={v => setValue(sanitizeKhDigits(v))}
            keyboardType="phone-pad"
            maxLength={12}
            autoFocus
          />
        </View>
      ) : (
        <TextInput
          style={ps.editInput}
          placeholder="Your full name"
          placeholderTextColor={JIH.w30}
          value={value}
          onChangeText={setValue}
          autoCapitalize="words"
          autoFocus
        />
      )}

      <View style={ps.editActions}>
        <Pressable onPress={onCancel} style={ps.editCancelBtn}>
          <Text style={ps.editCancelTxt}>Cancel</Text>
        </Pressable>
        <Pressable onPress={handleSave} style={ps.editSaveBtn}>
          <Text style={ps.editSaveTxt}>Save</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const [userId,      setUserId]    = useState<string | null>(null);
  const [authLoading, setAuthLoad]  = useState(true);
  const [profile,     setProfile]   = useState<Profile | null>(null);
  const [rides,       setRides]     = useState(0);
  const [spent,       setSpent]     = useState(0);
  const [loading,     setLoading]   = useState(false);
  const [editing,     setEditing]   = useState<'name' | 'phone' | null>(null);
  const [topUpLoading, setTopUpLoading] = useState(false);

  // Auth listener
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUserId(session?.user?.id ?? null);
      setAuthLoad(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => {
      setUserId(s?.user?.id ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  // Fetch profile + ride stats
  const loadProfile = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const [profRes, rideRes] = await Promise.all([
        supabase.from('profiles').select('full_name, phone, email, wallet_balance, created_at').eq('id', userId).single(),
        supabase.from('rides').select('final_fare, estimated_fare, offered_fare').eq('passenger_id', userId).eq('status', 'completed'),
      ]);
      if (profRes.data) setProfile(profRes.data as Profile);
      if (rideRes.data) {
        setRides(rideRes.data.length);
        setSpent(rideRes.data.reduce((s, r) => s + (r.final_fare ?? r.estimated_fare ?? r.offered_fare ?? 0), 0));
      }
    } finally { setLoading(false); }
  }, [userId]);

  useEffect(() => { if (userId) loadProfile(); }, [userId, loadProfile]);

  // Save profile field
  const handleSave = useCallback(async (field: 'name' | 'phone', value: string) => {
    if (!userId) return;
    const patch = field === 'name' ? { full_name: value } : { phone: value || null };
    const { error } = await supabase.from('profiles').update(patch).eq('id', userId);
    if (error) { Alert.alert('Error', error.message); return; }
    setProfile(p => p ? { ...p, ...(field === 'name' ? { full_name: value } : { phone: value }) } : p);
    setEditing(null);
  }, [userId]);

  // Top-up wallet (demo preset amounts)
  const handleTopUp = useCallback(() => {
    Alert.alert('Top Up Wallet', 'Choose an amount to add:', [
      { text: '+ $5',  onPress: () => addFunds(5) },
      { text: '+ $10', onPress: () => addFunds(10) },
      { text: '+ $20', onPress: () => addFunds(20) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [userId, profile]); // eslint-disable-line react-hooks/exhaustive-deps

  const addFunds = async (amount: number) => {
    if (!userId || !profile) return;
    setTopUpLoading(true);
    const newBalance = profile.wallet_balance + amount;
    const { error } = await supabase.from('profiles').update({ wallet_balance: newBalance }).eq('id', userId);
    if (error) Alert.alert('Error', error.message);
    else { setProfile(p => p ? { ...p, wallet_balance: newBalance } : p); Alert.alert('Success', `$${amount} added to your wallet!`); }
    setTopUpLoading(false);
  };

  // Initials avatar
  const initials = profile?.full_name
    ? profile.full_name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
    : '?';

  const memberSince = profile?.created_at
    ? new Date(profile.created_at).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
    : '—';

  if (authLoading) {
    return <View style={[ps.screen, { justifyContent: 'center', alignItems: 'center', paddingTop: insets.top }]}><ActivityIndicator color={JIH.gold} size="large" /></View>;
  }

  if (!userId) return <SignInPrompt insets={insets} />;

  return (
    <KeyboardAvoidingView style={[ps.screen, { paddingTop: insets.top }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>

      {/* Header */}
      <View style={ps.header}>
        <Text style={ps.headerTitle}>My Account</Text>
        <Pressable onPress={() => supabase.auth.signOut()} style={ps.signOutBtn}>
          <Sym name="rectangle.portrait.and.arrow.right" size={14} color={JIH.w55} />
          <Text style={ps.signOutTxt}>Sign out</Text>
        </Pressable>
      </View>

      <ScrollView
        style={ps.scroll}
        contentContainerStyle={[ps.scrollContent, { paddingBottom: insets.bottom + BottomTabInset + Spacing.four }]}
        showsVerticalScrollIndicator={false}>

        {loading && !profile ? (
          <View style={{ paddingTop: 60, alignItems: 'center' }}><ActivityIndicator color={JIH.gold} /></View>
        ) : (
          <>
            {/* Avatar + name */}
            <View style={ps.avatarSection}>
              <View style={ps.avatarCircle}>
                <Text style={ps.avatarTxt}>{initials}</Text>
              </View>
              <Text style={ps.displayName}>{profile?.full_name ?? 'Passenger'}</Text>
              <Text style={ps.displayEmail}>{profile?.email ?? ''}</Text>
              <Text style={ps.memberSince}>Member since {memberSince}</Text>
            </View>

            {/* Stats */}
            <View style={ps.statsRow}>
              <StatCard icon="car.fill"         label="Completed"    value={String(rides)} />
              <View style={ps.statsDivider} />
              <StatCard icon="dollarsign.circle" label="Total spent"  value={`$${spent.toFixed(2)}`} />
              <View style={ps.statsDivider} />
              <StatCard icon="star.fill"         label="Member since" value={memberSince} />
            </View>

            {/* Wallet */}
            <View style={ps.walletCard}>
              <View style={ps.walletLeft}>
                <Sym name="wallet.pass.fill" size={20} color={JIH.gold} />
                <View>
                  <Text style={ps.walletLabel}>Wallet Balance</Text>
                  <Text style={ps.walletBalance}>${(profile?.wallet_balance ?? 0).toFixed(2)}</Text>
                </View>
              </View>
              <Pressable onPress={handleTopUp} disabled={topUpLoading} style={ps.topUpBtn}>
                {topUpLoading ? <ActivityIndicator size="small" color={JIH.navy} /> : (
                  <><Sym name="plus" size={13} color={JIH.navy} /><Text style={ps.topUpTxt}>Top Up</Text></>
                )}
              </Pressable>
            </View>

            {/* Profile info */}
            <Text style={ps.sectionTitle}>Profile</Text>
            <View style={ps.card}>
              <InfoRow icon="person.fill"     label="Full Name" value={profile?.full_name ?? ''}      editable onEdit={() => setEditing('name')} />
              <View style={ps.rowDivider} />
              <InfoRow icon="envelope.fill"   label="Email"     value={profile?.email ?? ''}          />
              <View style={ps.rowDivider} />
              <InfoRow icon="phone.fill"      label="Phone"     value={profile?.phone ? `+855 ${displayPhone(profile.phone)}` : 'Not set'} editable onEdit={() => setEditing('phone')} />
            </View>

            {/* Account actions */}
            <Text style={ps.sectionTitle}>Settings</Text>
            <View style={ps.card}>
              <Pressable style={ps.actionRow}
                onPress={() => Linking.openURL('https://jihwithme.com/forgot-password')}>
                <View style={ps.infoIconBox}><Sym name="key.fill" size={16} color={JIH.gold} /></View>
                <Text style={ps.actionTxt}>Change Password</Text>
                <Sym name="chevron.right" size={14} color={JIH.w30} />
              </Pressable>
              <View style={ps.rowDivider} />
              <Pressable style={ps.actionRow}
                onPress={() => Linking.openURL('https://jihwithme.com/privacy')}>
                <View style={ps.infoIconBox}><Sym name="lock.shield.fill" size={16} color={JIH.gold} /></View>
                <Text style={ps.actionTxt}>Privacy Policy</Text>
                <Sym name="chevron.right" size={14} color={JIH.w30} />
              </Pressable>
              <View style={ps.rowDivider} />
              <Pressable style={ps.actionRow}
                onPress={() => Linking.openURL('https://jihwithme.com/terms')}>
                <View style={ps.infoIconBox}><Sym name="doc.text.fill" size={16} color={JIH.gold} /></View>
                <Text style={ps.actionTxt}>Terms of Service</Text>
                <Sym name="chevron.right" size={14} color={JIH.w30} />
              </Pressable>
            </View>

            {/* Danger zone */}
            <Pressable
              style={ps.signOutFullBtn}
              onPress={() => Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Sign Out', style: 'destructive', onPress: () => supabase.auth.signOut() },
              ])}>
              <Sym name="rectangle.portrait.and.arrow.right" size={17} color="#EF4444" />
              <Text style={ps.signOutFullTxt}>Sign Out</Text>
            </Pressable>
          </>
        )}
      </ScrollView>

      {/* Edit sheet */}
      {editing && profile && (
        <View style={ps.editOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setEditing(null)} />
          <EditSheet
            field={editing}
            current={editing === 'name' ? (profile.full_name ?? '') : (profile.phone ?? '')}
            onSave={v => handleSave(editing, v)}
            onCancel={() => setEditing(null)}
          />
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const ps = StyleSheet.create({
  screen:      { flex: 1, backgroundColor: JIH.navy },
  header:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.four, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: JIH.navyXL },
  headerTitle: { color: JIH.white, fontSize: 18, fontWeight: '700' },
  signOutBtn:  { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: JIH.navyXL },
  signOutTxt:  { color: JIH.w55, fontSize: 12, fontWeight: '500' },

  scroll:        { flex: 1 },
  scrollContent: { paddingHorizontal: Spacing.four, paddingTop: Spacing.three, gap: Spacing.three },

  // Avatar section
  avatarSection: { alignItems: 'center', gap: Spacing.one, paddingVertical: Spacing.two },
  avatarCircle:  { width: 80, height: 80, borderRadius: 40, backgroundColor: JIH.gold, alignItems: 'center', justifyContent: 'center', shadowColor: JIH.gold, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 12, elevation: 8 },
  avatarTxt:     { color: JIH.navy, fontSize: 30, fontWeight: '800' },
  displayName:   { color: JIH.white, fontSize: 22, fontWeight: '700', marginTop: 4 },
  displayEmail:  { color: JIH.w55, fontSize: 14 },
  memberSince:   { color: JIH.w30, fontSize: 12 },

  // Stats
  statsRow:     { flexDirection: 'row', backgroundColor: JIH.navyM, borderRadius: 16, borderWidth: 1, borderColor: JIH.navyXL, padding: Spacing.three },
  statCard:     { flex: 1, alignItems: 'center', gap: 5 },
  statValue:    { color: JIH.white, fontSize: 18, fontWeight: '700' },
  statLabel:    { color: JIH.w55, fontSize: 11 },
  statsDivider: { width: StyleSheet.hairlineWidth, backgroundColor: JIH.navyXL, alignSelf: 'stretch' },

  // Wallet
  walletCard:    { flexDirection: 'row', alignItems: 'center', backgroundColor: JIH.navyM, borderRadius: 16, borderWidth: 1, borderColor: JIH.navyXL, padding: Spacing.three, justifyContent: 'space-between' },
  walletLeft:    { flexDirection: 'row', alignItems: 'center', gap: 12 },
  walletLabel:   { color: JIH.w55, fontSize: 12 },
  walletBalance: { color: JIH.gold, fontSize: 22, fontWeight: '700' },
  topUpBtn:      { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: JIH.gold, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10 },
  topUpTxt:      { color: JIH.navy, fontSize: 13, fontWeight: '700' },

  // Card
  card:        { backgroundColor: JIH.navyM, borderRadius: 16, borderWidth: 1, borderColor: JIH.navyXL, overflow: 'hidden' },
  rowDivider:  { height: StyleSheet.hairlineWidth, backgroundColor: JIH.navyXL, marginLeft: 52 },
  sectionTitle:{ color: JIH.w55, fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.8 },

  // Info rows
  infoRow:     { flexDirection: 'row', alignItems: 'center', padding: Spacing.three, gap: 12 },
  infoIconBox: { width: 32, height: 32, borderRadius: 9, backgroundColor: `${JIH.gold}18`, alignItems: 'center', justifyContent: 'center' },
  infoText:    { flex: 1 },
  infoLabel:   { color: JIH.w30, fontSize: 11, marginBottom: 2 },
  infoValue:   { color: JIH.white, fontSize: 15, fontWeight: '500' },
  infoEditBtn: { padding: 6 },

  // Action rows
  actionRow: { flexDirection: 'row', alignItems: 'center', padding: Spacing.three, gap: 12 },
  actionTxt: { flex: 1, color: JIH.w70, fontSize: 15 },

  // Sign out button
  signOutFullBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: JIH.navyM, borderRadius: 14, paddingVertical: 15, borderWidth: 1.5, borderColor: '#EF444430' },
  signOutFullTxt: { color: '#EF4444', fontSize: 15, fontWeight: '700' },

  // Edit sheet
  editOverlay:    { position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  editSheet:      { backgroundColor: JIH.navyM, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: Spacing.four, paddingBottom: 36, gap: Spacing.three },
  editSheetHandle:{ width: 40, height: 4, borderRadius: 2, backgroundColor: JIH.navyXL, alignSelf: 'center' },
  editSheetTitle: { color: JIH.white, fontSize: 17, fontWeight: '700' },
  editInput:      { backgroundColor: JIH.navyL, borderRadius: 12, borderWidth: 1, borderColor: JIH.navyXL, color: JIH.white, fontSize: 16, paddingHorizontal: Spacing.three, paddingVertical: 13 },
  phoneRow:       { flexDirection: 'row', borderRadius: 12, borderWidth: 1, borderColor: JIH.navyXL, overflow: 'hidden' },
  phonePrefix:    { backgroundColor: JIH.navyL, paddingHorizontal: Spacing.three, justifyContent: 'center', borderRightWidth: 1, borderRightColor: JIH.navyXL },
  phonePrefixTxt: { color: JIH.w55, fontSize: 15, fontWeight: '600' },
  phoneInput:     { flex: 1, backgroundColor: JIH.navyL, color: JIH.white, fontSize: 15, paddingHorizontal: Spacing.three, paddingVertical: 13 },
  editActions:    { flexDirection: 'row', gap: Spacing.two },
  editCancelBtn:  { flex: 1, borderRadius: 12, paddingVertical: 13, alignItems: 'center', borderWidth: 1.5, borderColor: JIH.navyXL },
  editCancelTxt:  { color: JIH.w55, fontSize: 15, fontWeight: '600' },
  editSaveBtn:    { flex: 1, borderRadius: 12, paddingVertical: 13, alignItems: 'center', backgroundColor: JIH.gold },
  editSaveTxt:    { color: JIH.navy, fontSize: 15, fontWeight: '700' },
});
