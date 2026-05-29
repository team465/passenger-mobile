/**
 * Support screen
 * Emergency contacts, submit support ticket, FAQ accordion.
 */
import { SymbolView } from 'expo-symbols';
import { useState, useEffect, useCallback } from 'react';
import {
  ActivityIndicator,
  Alert,
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

// ─── Emergency contacts (mirrors jihwolrd SafetyCenter.tsx) ──────────────────

const EMERGENCY = [
  { label: 'Police',         number: '117',          icon: 'shield.fill',         color: '#3B82F6' },
  { label: 'Ambulance',      number: '119',          icon: 'cross.fill',           color: '#EF4444' },
  { label: 'Fire Brigade',   number: '118',          icon: 'flame.fill',           color: '#F59E0B' },
  { label: 'Tourist Police', number: '012 942 484',  icon: 'person.badge.shield.checkmark', color: '#8B5CF6' },
];

// ─── Ticket categories (mirrors support_tickets.category) ────────────────────

const CATEGORIES = [
  { id: 'billing',  label: 'Billing',          icon: 'creditcard.fill' },
  { id: 'safety',   label: 'Safety',           icon: 'shield.fill' },
  { id: 'driver',   label: 'Driver Issue',     icon: 'person.fill' },
  { id: 'general',  label: 'General',          icon: 'questionmark.circle.fill' },
  { id: 'other',    label: 'Other',            icon: 'ellipsis.circle.fill' },
] as const;
type CategoryId = (typeof CATEGORIES)[number]['id'];

// ─── FAQ data ─────────────────────────────────────────────────────────────────

const FAQ = [
  {
    q: 'How do I book a ride?',
    a: 'Open the Book tab, enter your pickup location and destination, choose a ride type, select payment, and tap Book.',
  },
  {
    q: 'Can I cancel my ride?',
    a: 'Yes — go to My Rides, find your active or scheduled ride, and tap Cancel. Free cancellation before a driver is matched.',
  },
  {
    q: 'How does the wallet work?',
    a: 'Add funds to your wallet from the Profile tab. The balance is deducted automatically when you pay via Wallet.',
  },
  {
    q: 'What is Full Day hire?',
    a: 'Full Day hire lets you book a vehicle for an entire day at a negotiated price. Enter your trip description and offered price.',
  },
  {
    q: 'What is a Scheduled ride?',
    a: 'Schedule a ride in advance (min. 30 min ahead). A driver will be matched close to your departure time.',
  },
  {
    q: 'How do I contact my driver?',
    a: "Once a driver is matched (Driver on the Way status), the driver's contact details will be shown in your active ride.",
  },
];

// ─── FAQ Item ─────────────────────────────────────────────────────────────────

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={ss.faqItem}>
      <Pressable style={ss.faqQ} onPress={() => setOpen(v => !v)}>
        <Text style={ss.faqQTxt}>{q}</Text>
        <Sym name={open ? 'chevron.up' : 'chevron.down'} size={13} color={JIH.w55} />
      </Pressable>
      {open && <Text style={ss.faqA}>{a}</Text>}
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function SupportScreen() {
  const insets = useSafeAreaInsets();
  const [userId,   setUserId]   = useState<string | null>(null);
  const [category, setCategory] = useState<CategoryId>('general');
  const [subject,  setSubject]  = useState('');
  const [message,  setMessage]  = useState('');
  const [loading,  setLoading]  = useState(false);
  const [sent,     setSent]     = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setUserId(session?.user?.id ?? null));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setUserId(s?.user?.id ?? null));
    return () => subscription.unsubscribe();
  }, []);

  const handleCall = (number: string) => {
    const clean = number.replace(/\s/g, '');
    Linking.openURL(`tel:${clean}`).catch(() => Alert.alert('Cannot call', `Please dial ${number} manually.`));
  };

  const handleSubmit = useCallback(async () => {
    if (!subject.trim()) { Alert.alert('Required', 'Please enter a subject.'); return; }
    if (!message.trim()) { Alert.alert('Required', 'Please describe your issue.'); return; }
    if (!userId) { Alert.alert('Sign in required', 'Please sign in via the Book tab to submit a ticket.'); return; }
    setLoading(true);
    try {
      const { error } = await supabase.from('support_tickets').insert({
        user_id:  userId,
        role:     'passenger',
        category,
        subject:  subject.trim(),
        message:  message.trim(),
        status:   'open',
        priority: category === 'safety' ? 'high' : 'normal',
      });
      if (error) throw error;
      setSent(true);
      setSubject(''); setMessage('');
      setTimeout(() => setSent(false), 4000);
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed to send ticket.');
    } finally { setLoading(false); }
  }, [userId, category, subject, message]);

  return (
    <View style={[ss.screen, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={ss.header}>
        <View style={ss.headerLeft}>
          <View style={ss.headerIcon}><Sym name="questionmark.circle.fill" size={18} color={JIH.navy} /></View>
          <Text style={ss.headerTitle}>Support</Text>
        </View>
        <Text style={ss.headerSub}>We're here to help</Text>
      </View>

      <ScrollView
        style={ss.scroll}
        contentContainerStyle={[ss.scrollContent, { paddingBottom: insets.bottom + BottomTabInset + Spacing.four }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled">

        {/* ── Emergency contacts ── */}
        <View style={ss.section}>
          <View style={ss.sectionHeader}>
            <Sym name="exclamationmark.triangle.fill" size={14} color="#EF4444" />
            <Text style={ss.sectionTitle}>Emergency Contacts</Text>
          </View>
          <View style={ss.emergencyGrid}>
            {EMERGENCY.map(e => (
              <Pressable key={e.number} onPress={() => handleCall(e.number)}
                style={ss.emergencyCard}>
                <View style={[ss.emergencyIcon, { backgroundColor: `${e.color}22` }]}>
                  <Sym name={e.icon} size={22} color={e.color} />
                </View>
                <Text style={ss.emergencyLabel}>{e.label}</Text>
                <Text style={[ss.emergencyNumber, { color: e.color }]}>{e.number}</Text>
                <View style={[ss.callBtn, { backgroundColor: `${e.color}18`, borderColor: `${e.color}44` }]}>
                  <Sym name="phone.fill" size={11} color={e.color} />
                  <Text style={[ss.callBtnTxt, { color: e.color }]}>Call</Text>
                </View>
              </Pressable>
            ))}
          </View>
        </View>

        {/* ── Submit ticket ── */}
        <View style={ss.section}>
          <View style={ss.sectionHeader}>
            <Sym name="envelope.fill" size={14} color={JIH.gold} />
            <Text style={ss.sectionTitle}>Submit a Ticket</Text>
          </View>

          {sent && (
            <View style={ss.successBanner}>
              <Sym name="checkmark.circle.fill" size={18} color="#22C55E" />
              <Text style={ss.successTxt}>Ticket submitted! We'll get back to you soon.</Text>
            </View>
          )}

          {/* Category selector */}
          <Text style={ss.fieldLabel}>Category</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={ss.categoryRow}>
            {CATEGORIES.map(c => (
              <Pressable key={c.id} onPress={() => setCategory(c.id)}
                style={[ss.categoryPill, category === c.id && ss.categoryPillActive]}>
                <Sym name={c.icon} size={13} color={category === c.id ? JIH.gold : JIH.w55} />
                <Text style={[ss.categoryPillTxt, category === c.id && ss.categoryPillTxtActive]}>{c.label}</Text>
              </Pressable>
            ))}
          </ScrollView>

          {/* Subject */}
          <Text style={ss.fieldLabel}>Subject</Text>
          <TextInput
            style={ss.textInput}
            placeholder="Brief summary of your issue"
            placeholderTextColor={JIH.w30}
            value={subject}
            onChangeText={setSubject}
            returnKeyType="next"
            maxLength={120}
          />

          {/* Message */}
          <Text style={ss.fieldLabel}>Message</Text>
          <TextInput
            style={[ss.textInput, ss.textArea]}
            placeholder="Describe your issue in detail…"
            placeholderTextColor={JIH.w30}
            value={message}
            onChangeText={setMessage}
            multiline
            numberOfLines={5}
            textAlignVertical="top"
            maxLength={1000}
          />
          <Text style={ss.charCount}>{message.length} / 1000</Text>

          {/* Submit */}
          <Pressable onPress={handleSubmit} disabled={loading}
            style={({ pressed }) => [ss.submitBtn, { opacity: pressed || loading ? 0.8 : 1 }]}>
            {loading ? <ActivityIndicator color={JIH.navy} /> : (
              <><Sym name="paperplane.fill" size={16} color={JIH.navy} /><Text style={ss.submitTxt}>Send Ticket</Text></>
            )}
          </Pressable>

          {!userId && (
            <Text style={ss.signInNote}>
              Sign in via the Book tab to submit a support ticket.
            </Text>
          )}
        </View>

        {/* ── FAQ ── */}
        <View style={ss.section}>
          <View style={ss.sectionHeader}>
            <Sym name="text.bubble.fill" size={14} color={JIH.gold} />
            <Text style={ss.sectionTitle}>Frequently Asked Questions</Text>
          </View>
          <View style={ss.faqCard}>
            {FAQ.map((item, i) => (
              <View key={i}>
                <FaqItem q={item.q} a={item.a} />
                {i < FAQ.length - 1 && <View style={ss.faqDivider} />}
              </View>
            ))}
          </View>
        </View>

        {/* ── Contact info ── */}
        <View style={ss.contactCard}>
          <Sym name="envelope.badge.fill" size={20} color={JIH.gold} />
          <View style={{ flex: 1 }}>
            <Text style={ss.contactTitle}>Email Support</Text>
            <Text style={ss.contactSub}>support@jihwithme.com</Text>
          </View>
          <Pressable onPress={() => Linking.openURL('mailto:support@jihwithme.com')} style={ss.contactBtn}>
            <Text style={ss.contactBtnTxt}>Email</Text>
          </Pressable>
        </View>

        <Text style={ss.versionTxt}>JihWolrd Passenger App · v1.0</Text>
      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const ss = StyleSheet.create({
  screen:  { flex: 1, backgroundColor: JIH.navy },
  header:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.four, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: JIH.navyXL },
  headerLeft:  { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerIcon:  { width: 32, height: 32, borderRadius: 9, backgroundColor: JIH.gold, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: JIH.white, fontSize: 18, fontWeight: '700' },
  headerSub:   { color: JIH.w55, fontSize: 13 },

  scroll:        { flex: 1 },
  scrollContent: { paddingHorizontal: Spacing.four, paddingTop: Spacing.three, gap: Spacing.four },

  section:       { gap: Spacing.two },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionTitle:  { color: JIH.white, fontSize: 16, fontWeight: '700' },
  fieldLabel:    { color: JIH.w55, fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.8, marginTop: Spacing.one },

  // Emergency grid
  emergencyGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  emergencyCard: { flex: 1, minWidth: '45%', backgroundColor: JIH.navyM, borderRadius: 16, borderWidth: 1, borderColor: JIH.navyXL, padding: Spacing.three, alignItems: 'center', gap: 6 },
  emergencyIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  emergencyLabel:{ color: JIH.w55, fontSize: 12, fontWeight: '600' },
  emergencyNumber:{ fontSize: 16, fontWeight: '800' },
  callBtn:       { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 5, borderRadius: 8, borderWidth: 1 },
  callBtnTxt:    { fontSize: 12, fontWeight: '700' },

  // Success banner
  successBanner: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#D1FAE5', borderRadius: 12, padding: Spacing.two + 2 },
  successTxt:    { color: '#065F46', fontSize: 13, fontWeight: '600', flex: 1 },

  // Category pills
  categoryRow:        { gap: Spacing.two, paddingVertical: 4 },
  categoryPill:       { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1.5, borderColor: JIH.navyXL, backgroundColor: JIH.navyM },
  categoryPillActive: { borderColor: JIH.gold, backgroundColor: `${JIH.gold}18` },
  categoryPillTxt:    { color: JIH.w55, fontSize: 13, fontWeight: '600' },
  categoryPillTxtActive: { color: JIH.gold },

  // Form inputs
  textInput:  { backgroundColor: JIH.navyM, borderRadius: 12, borderWidth: 1, borderColor: JIH.navyXL, color: JIH.white, fontSize: 14, paddingHorizontal: Spacing.three, paddingVertical: 12 },
  textArea:   { height: 110, paddingTop: 12 },
  charCount:  { color: JIH.w30, fontSize: 11, textAlign: 'right', marginTop: -4 },
  signInNote: { color: JIH.w30, fontSize: 12, textAlign: 'center', marginTop: 4 },

  // Submit button
  submitBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: JIH.gold, borderRadius: 14, paddingVertical: 14, marginTop: Spacing.one, shadowColor: JIH.gold, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 10, elevation: 6 },
  submitTxt: { color: JIH.navy, fontSize: 16, fontWeight: '700' },

  // FAQ
  faqCard:    { backgroundColor: JIH.navyM, borderRadius: 16, borderWidth: 1, borderColor: JIH.navyXL, overflow: 'hidden' },
  faqItem:    { padding: Spacing.three },
  faqQ:       { flexDirection: 'row', alignItems: 'center', gap: 8 },
  faqQTxt:    { flex: 1, color: JIH.white, fontSize: 14, fontWeight: '600' },
  faqA:       { color: JIH.w55, fontSize: 13, lineHeight: 20, marginTop: 8 },
  faqDivider: { height: StyleSheet.hairlineWidth, backgroundColor: JIH.navyXL },

  // Contact
  contactCard:   { flexDirection: 'row', alignItems: 'center', backgroundColor: JIH.navyM, borderRadius: 16, borderWidth: 1, borderColor: JIH.navyXL, padding: Spacing.three, gap: 12 },
  contactTitle:  { color: JIH.white, fontSize: 14, fontWeight: '600' },
  contactSub:    { color: JIH.w55, fontSize: 12 },
  contactBtn:    { backgroundColor: JIH.gold, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 8 },
  contactBtnTxt: { color: JIH.navy, fontSize: 13, fontWeight: '700' },

  versionTxt: { color: JIH.w30, fontSize: 11, textAlign: 'center' },
});
