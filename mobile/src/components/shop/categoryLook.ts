import type Ionicons from '@expo/vector-icons/Ionicons';

type Look = { icon: keyof typeof Ionicons.glyphMap; bg: string; fg: string };

const LOOKS: [RegExp, Look][] = [
  [/stapl|grocer|atta|rice|dal|flour|grain/i, { icon: 'basket-outline', bg: '#FFF4E0', fg: '#B76E00' }],
  [/sugar|salt|spice|masala/i, { icon: 'cube-outline', bg: '#FFF4E0', fg: '#B76E00' }],
  [/oil|ghee/i, { icon: 'water-outline', bg: '#FFF8C5', fg: '#9A6700' }],
  [/snack|chip|namkeen|biscuit|cookie/i, { icon: 'fast-food-outline', bg: '#FFEBE9', fg: '#CF222E' }],
  [/beverage|drink|tea|coffee|juice/i, { icon: 'cafe-outline', bg: '#E8F0FE', fg: '#1557C0' }],
  [/personal|beauty|soap|shampoo|care$/i, { icon: 'sparkles-outline', bg: '#FBEFFF', fg: '#8250DF' }],
  [/home|clean|detergent|wash/i, { icon: 'home-outline', bg: '#DAFBE1', fg: '#1A7F37' }],
  [/dairy|milk/i, { icon: 'nutrition-outline', bg: '#E8F0FE', fg: '#1557C0' }],
  [/baby|kid/i, { icon: 'happy-outline', bg: '#FBEFFF', fg: '#8250DF' }],
];

const FALLBACK: Look[] = [
  { icon: 'pricetags-outline', bg: '#E8F0FE', fg: '#1557C0' },
  { icon: 'pricetags-outline', bg: '#DAFBE1', fg: '#1A7F37' },
  { icon: 'pricetags-outline', bg: '#FFF4E0', fg: '#B76E00' },
];

/** An icon and colours for a category tile, picked from its name. */
export function categoryLook(name: string, index: number): Look {
  return LOOKS.find(([re]) => re.test(name))?.[1] ?? FALLBACK[index % FALLBACK.length];
}
