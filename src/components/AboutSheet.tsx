import React from 'react';
import { Linking, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import appConfig from '../../app.json';
import { useConfigStore } from '../config/configStore';

/**
 * About / attribution screen. Surfaces the required data + basemap credits
 * (from runtime config) and version info — satisfies App Store review
 * requirements for third-party data attribution and non-affiliation.
 */

// expo-application is a native module; requireNativeModule throws if it isn't
// linked (e.g. a dev client built before it was added). Read it defensively —
// native values are authoritative on a real build, else fall back to app.json.
function readNativeVersion(): { version: string | null; build: string | null } {
  try {
    const App = require('expo-application') as typeof import('expo-application');
    return { version: App.nativeApplicationVersion, build: App.nativeBuildVersion };
  } catch {
    return { version: null, build: null };
  }
}

const native = readNativeVersion();
const APP_VERSION = native.version ?? appConfig.expo.version;
const BUILD_NUMBER = native.build;
const APP_NAME = appConfig.expo.name;

export function AboutSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const attribution = useConfigStore((s) => s.config.attribution);
  const configSource = useConfigStore((s) => s.config.source);
  const configUpdated = useConfigStore((s) => s.config.updated);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>About</Text>
            <TouchableOpacity onPress={onClose}>
              <Text style={styles.close}>Done</Text>
            </TouchableOpacity>
          </View>

          <ScrollView>
            <Text style={styles.appName}>{APP_NAME}</Text>
            <Text style={styles.version}>
              Version {APP_VERSION}
              {BUILD_NUMBER ? ` (${BUILD_NUMBER})` : ''}
            </Text>

            <Section title="Data &amp; attribution">
              <Text style={styles.body}>{attribution.data}</Text>
              <Text style={styles.body}>{attribution.map}</Text>
              <Text style={styles.body}>Rail network geometry © MassGIS (Commonwealth of Massachusetts).</Text>
            </Section>

            <Section title="Not affiliated with the MBTA">
              <Text style={styles.body}>
                Highball Boston is an independent hobbyist project. It is not affiliated with,
                endorsed by, or sponsored by the MBTA, MassDOT, or the Commonwealth of Massachusetts.
                “MBTA” and related marks belong to their respective owners.
              </Text>
            </Section>

            <Section title="Data sources">
              <LinkRow label="MBTA v3 API" url="https://api-v3.mbta.com" />
              <LinkRow label="MBTA developer portal" url="https://www.mbta.com/developers" />
              <LinkRow label="MassGIS" url="https://www.mass.gov/orgs/massgis-bureau-of-geographic-information" />
            </Section>

            <Text style={styles.configNote}>
              Runtime config: {configSource}
              {configUpdated ? ` · updated ${configUpdated}` : ''}
            </Text>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function LinkRow({ label, url }: { label: string; url: string }) {
  return (
    <TouchableOpacity onPress={() => Linking.openURL(url)}>
      <Text style={styles.link}>{label} ↗</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#16181D',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 28,
    maxHeight: '85%',
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  title: { color: '#fff', fontSize: 18, fontWeight: '800' },
  close: { color: '#F5C518', fontSize: 15, fontWeight: '700' },
  appName: { color: '#fff', fontSize: 22, fontWeight: '800', marginTop: 6 },
  version: { color: '#8A909B', fontSize: 13, marginTop: 2 },
  section: { marginTop: 20 },
  sectionTitle: { color: '#F5C518', fontSize: 13, fontWeight: '800', marginBottom: 6, textTransform: 'uppercase' },
  body: { color: '#C9CDD4', fontSize: 13, lineHeight: 19, marginBottom: 6 },
  link: { color: '#5DADE2', fontSize: 14, fontWeight: '600', paddingVertical: 6 },
  configNote: { color: '#5A606B', fontSize: 11, marginTop: 24 },
});
