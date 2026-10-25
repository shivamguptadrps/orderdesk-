import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { firstQty } from '@/components/ui';
import { inr, mediaUrl, packName, saving } from '@/lib/format';
import { colors, radius } from '@/lib/theme';
import type { CartLine, CatalogCard, Unit } from '@/lib/types';

/**
 * The add button every shopping app has: "ADD", then − qty + once it's in the cart.
 * Uses the pack's minimum and step quantities.
 */
export function AddControl({
  unit,
  line,
  busy,
  disabled,
  onAdd,
  onQty,
  size = 'md',
}: {
  unit: Pick<Unit, 'min_qty' | 'step_qty' | 'max_qty'>;
  line?: CartLine;
  busy: boolean;
  disabled?: boolean;
  onAdd: () => void;
  onQty: (qty: number) => void;
  size?: 'md' | 'lg';
}) {
  const h = size === 'lg' ? 48 : 36;
  if (!line) {
    const first = firstQty(unit.min_qty, unit.step_qty);
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add to cart"
        onPress={onAdd}
        disabled={busy || disabled}
        style={({ pressed }) => [styles.add, { height: h }, size === 'lg' && styles.addLg, disabled && styles.addOff, pressed && { opacity: 0.8 }]}>
        {busy ? (
          <ActivityIndicator size="small" color={size === 'lg' ? '#FFFFFF' : colors.primary} />
        ) : (
          <Text style={[styles.addText, size === 'lg' && styles.addTextLg, disabled && { color: colors.faint }]}>
            {size === 'lg' ? `Add to cart${first > 1 ? ` (${first})` : ''}` : `ADD${first > 1 ? ` ${first}` : ''}`}
          </Text>
        )}
      </Pressable>
    );
  }
  const canUp = unit.max_qty === null || line.qty + line.step_qty <= unit.max_qty;
  return (
    <View style={[styles.stepper, { height: h }]}>
      <Pressable accessibilityLabel="Less" hitSlop={6} disabled={busy} onPress={() => onQty(line.qty - line.step_qty)} style={styles.stepBtn}>
        <Ionicons name={line.qty - line.step_qty < firstQty(line.min_qty, line.step_qty) ? 'trash-outline' : 'remove'} size={16} color="#FFFFFF" />
      </Pressable>
      {busy ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Text style={[styles.stepQty, size === 'lg' && { fontSize: 17 }]}>{line.qty}</Text>}
      <Pressable accessibilityLabel="More" hitSlop={6} disabled={busy || !canUp} onPress={() => onQty(line.qty + line.step_qty)} style={[styles.stepBtn, !canUp && { opacity: 0.4 }]}>
        <Ionicons name="add" size={16} color="#FFFFFF" />
      </Pressable>
    </View>
  );
}

/** Product card for the shop grid: photo with ADD on its corner, discount ribbon, pack, name, price + MRP. */
export function ProductTile({
  p,
  line,
  busy,
  locked,
  onOpen,
  onAdd,
  onQty,
}: {
  p: CatalogCard;
  line?: CartLine;
  busy: boolean;
  locked?: boolean;
  onOpen: () => void;
  onAdd: () => void;
  onQty: (qty: number) => void;
}) {
  const u = p.default_unit;
  const off = saving(p.mrp, u.price, u.pieces_per_unit);
  const sellable = p.in_stock && u.in_stock;
  return (
    <Pressable onPress={onOpen} style={({ pressed }) => [styles.tile, pressed && { opacity: 0.92 }]}>
      <View style={styles.imageBox}>
        {p.image ? (
          <Image source={{ uri: mediaUrl(p.image) }} style={[StyleSheet.absoluteFill, { borderRadius: 10 }, !sellable && { opacity: 0.4 }]} contentFit="cover" transition={150} />
        ) : (
          <Ionicons name="cube-outline" size={36} color={colors.faint} />
        )}
        {off && sellable ? (
          <View style={styles.ribbon}>
            <Text style={styles.ribbonText}>{off.percent}%</Text>
            <Text style={styles.ribbonSmall}>OFF</Text>
          </View>
        ) : null}
        {!sellable && (
          <View style={styles.outBadge}>
            <Text style={styles.outText}>Out of stock</Text>
          </View>
        )}
        {sellable && (
          <View style={styles.addSpot}>
            <AddControl unit={u} line={line} busy={busy} disabled={locked} onAdd={onAdd} onQty={onQty} />
          </View>
        )}
      </View>
      <View style={styles.body}>
        <View style={styles.packPill}>
          <Text style={styles.packText} numberOfLines={1}>
            {packName(u.name, u.pieces_per_unit)}
          </Text>
        </View>
        <Text style={styles.name} numberOfLines={2}>
          {p.name}
        </Text>
        <View style={styles.priceRow}>
          <Text style={styles.price}>{inr(u.price)}</Text>
          {off ? <Text style={styles.mrp}>{inr(off.mrp)}</Text> : null}
        </View>
        {u.pieces_per_unit > 1 ? <Text style={styles.perPc}>{inr(u.price_per_piece)} / piece</Text> : <Text style={styles.perPc}> </Text>}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: {
    flex: 1,
    maxWidth: '50%',
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 6,
    borderWidth: 1,
    borderColor: '#EEF0F3',
  },
  imageBox: {
    aspectRatio: 1,
    backgroundColor: '#F4F6F8',
    borderRadius: 10,
    overflow: 'visible',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ribbon: {
    position: 'absolute',
    left: 8,
    top: 0,
    backgroundColor: colors.primaryDark,
    paddingHorizontal: 5,
    paddingTop: 3,
    paddingBottom: 5,
    borderBottomLeftRadius: 6,
    borderBottomRightRadius: 6,
    alignItems: 'center',
  },
  ribbonText: { color: '#FFFFFF', fontSize: 12, fontWeight: '900', lineHeight: 14 },
  ribbonSmall: { color: '#FFFFFF', fontSize: 9, fontWeight: '800', lineHeight: 10 },
  outBadge: {
    position: 'absolute',
    bottom: 8,
    alignSelf: 'center',
    backgroundColor: 'rgba(31,35,40,0.8)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  outText: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },
  addSpot: { position: 'absolute', right: 6, bottom: -14 },
  body: { paddingHorizontal: 4, paddingTop: 20, paddingBottom: 4 },
  packPill: { alignSelf: 'flex-start', backgroundColor: '#F1F3F5', borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 },
  packText: { fontSize: 11, fontWeight: '600', color: colors.muted },
  name: { fontSize: 13.5, fontWeight: '600', color: colors.text, minHeight: 36, lineHeight: 18, marginTop: 6 },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 6 },
  price: { fontSize: 16, fontWeight: '800', color: colors.text },
  mrp: { fontSize: 12, color: colors.faint, textDecorationLine: 'line-through' },
  perPc: { fontSize: 11, color: colors.muted, marginTop: 1 },
  add: {
    minWidth: 72,
    paddingHorizontal: 12,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderColor: colors.primary,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  addOff: { borderColor: colors.border, backgroundColor: colors.bg },
  addText: { color: colors.primary, fontWeight: '800', fontSize: 13, letterSpacing: 0.3 },
  stepper: {
    minWidth: 84,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.primary,
    borderRadius: radius.sm,
    paddingHorizontal: 2,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  stepBtn: { width: 28, height: '100%', alignItems: 'center', justifyContent: 'center' },
  addLg: { backgroundColor: colors.primary },
  addTextLg: { color: '#FFFFFF', fontSize: 16 },
  stepQty: { color: '#FFFFFF', fontWeight: '800', fontSize: 14, minWidth: 22, textAlign: 'center' },
});
