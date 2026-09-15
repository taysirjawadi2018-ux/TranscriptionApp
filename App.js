import React from 'react';
import { SafeAreaView } from 'react-native';
import DashboardScreen from './screens/DashboardScreen';

export default function App() {
  return (
    <SafeAreaView style={{ flex: 1 }}>
      <DashboardScreen />
    </SafeAreaView>
  );
}
