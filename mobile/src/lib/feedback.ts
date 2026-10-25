/**
 * Little sounds and vibrations that make actions feel done (like big shopping apps):
 * add to cart = pop + light tap, remove = soft tap, order placed / approved = chime + success buzz.
 * Respects the phone's silent switch and the user's "Sounds" setting. Never throws.
 */
import { type AudioPlayer, createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';
import { create } from 'zustand';

import { storage } from './storage';

const SOUNDS = {
  add: require('../../assets/sounds/add.wav'),
  remove: require('../../assets/sounds/remove.wav'),
  success: require('../../assets/sounds/success.wav'),
};
type Sound = keyof typeof SOUNDS;

const PREF_KEY = 'prefs.sound';

export const useFeedbackPrefs = create<{ sound: boolean; setSound: (on: boolean) => void }>()((set) => ({
  sound: true,
  setSound: (on) => {
    set({ sound: on });
    void storage.set(PREF_KEY, on ? '1' : '0').catch(() => undefined);
  },
}));
void storage
  .get(PREF_KEY)
  .then((v) => v === '0' && useFeedbackPrefs.setState({ sound: false }))
  .catch(() => undefined);

const players: Partial<Record<Sound, AudioPlayer>> = {};
let audioReady = false;

function play(sound: Sound) {
  if (!useFeedbackPrefs.getState().sound) return;
  try {
    if (!audioReady) {
      audioReady = true;
      // Follow the silent switch; mix with music instead of stopping it.
      void setAudioModeAsync({ playsInSilentMode: false, interruptionMode: 'mixWithOthers' }).catch(() => undefined);
    }
    let p = players[sound];
    if (!p) {
      p = createAudioPlayer(SOUNDS[sound]);
      p.volume = sound === 'success' ? 0.7 : 0.5;
      players[sound] = p;
    }
    void p.seekTo(0);
    p.play();
  } catch {
    // sound is a nicety; ignore any failure
  }
}

function buzz(fn: () => Promise<void>) {
  if (Platform.OS === 'web') return;
  fn().catch(() => undefined);
}

export const feedback = {
  /** Something went into the cart. */
  add() {
    buzz(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
    play('add');
  },
  /** Quantity changed with + / −. */
  tick() {
    buzz(() => Haptics.selectionAsync());
  },
  /** Something left the cart. */
  remove() {
    buzz(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft));
    play('remove');
  },
  /** Big moments: order placed, approved, dispatched, delivered. */
  success() {
    buzz(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
    play('success');
  },
  error() {
    buzz(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error));
  },
};
