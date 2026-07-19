import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { DEFAULT_CONFIG } from './defaults';
import { normalizeConfig, validateRawConfig, type RuntimeConfig } from './schema';

/**
 * Runtime config store. On launch: hydrate() loads the last cached copy (fast),
 * refresh() fetches the live config.json and re-caches. Everything falls back to
 * DEFAULT_CONFIG, so the app is fully functional offline / on first launch.
 *
 * Read reactively in components via `useConfigStore(s => s.config...)`, or
 * non-reactively in API/hook code via `getConfig()` (always the latest).
 */

const CONFIG_URL = 'https://trains.chrisnewell.net/config.json';
// Bumped to v2 so a stale v1 cache (heritage_units was a string array) is
// ignored rather than mis-normalized.
const CACHE_KEY = 'runtimeConfig.v2';

interface ConfigState {
  config: RuntimeConfig;
  /** Load the last good config from on-device cache (if any). */
  hydrate: () => Promise<void>;
  /** Fetch the live config.json, apply it, and re-cache. */
  refresh: () => Promise<void>;
}

export const useConfigStore = create<ConfigState>((set, get) => ({
  config: DEFAULT_CONFIG,

  hydrate: async () => {
    try {
      const raw = await AsyncStorage.getItem(CACHE_KEY);
      if (!raw) return;
      const valid = validateRawConfig(JSON.parse(raw));
      // Don't clobber a live fetch that already landed.
      if (get().config.source === 'default') {
        set({ config: normalizeConfig(valid, 'cached', DEFAULT_CONFIG) });
      }
    } catch {
      // Corrupt/incompatible cache — ignore, stay on default until refresh.
    }
  },

  refresh: async () => {
    try {
      const res = await fetch(CONFIG_URL, { headers: { Accept: 'application/json' } });
      if (!res.ok) return; // keep current
      const json = (await res.json()) as unknown;
      const valid = validateRawConfig(json);
      set({ config: normalizeConfig(valid, 'live', DEFAULT_CONFIG) });
      await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(json));
    } catch {
      // Unreachable / invalid — keep the cached or default config.
    }
  },
}));

/** Non-reactive accessor: latest effective config at call time. */
export function getConfig(): RuntimeConfig {
  return useConfigStore.getState().config;
}
