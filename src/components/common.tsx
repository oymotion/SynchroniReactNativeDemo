import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity } from 'react-native';
import { DemoController } from '../demo/DemoController';

/**
 * Re-render the component whenever DemoController notifies. Only subscribes
 * while `visible` so hidden tabs don't re-render on every 50ms plot tick.
 */
export function useDemoVersion(visible: boolean = true): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!visible) {
      return;
    }
    setVersion((v) => v + 1);
    return DemoController.Instance.subscribe(() => setVersion((v) => v + 1));
  }, [visible]);
  return version;
}

interface DemoButtonProps {
  title: string;
  onPress: () => void;
  disabled?: boolean;
}

export function DemoButton({ title, onPress, disabled }: DemoButtonProps) {
  return (
    <TouchableOpacity
      style={[styles.button, disabled && styles.buttonDisabled]}
      disabled={disabled}
      onPress={onPress}
    >
      <Text style={[styles.buttonText, disabled && styles.textDisabled]}>
        {title}
      </Text>
    </TouchableOpacity>
  );
}

interface CheckboxProps {
  label: string;
  checked: boolean;
  onToggle: (checked: boolean) => void;
  disabled?: boolean;
}

export function Checkbox({
  label,
  checked,
  onToggle,
  disabled,
}: CheckboxProps) {
  return (
    <TouchableOpacity
      style={styles.checkbox}
      disabled={disabled}
      onPress={() => onToggle(!checked)}
    >
      <Text style={[styles.checkboxBox, disabled && styles.textDisabled]}>
        {checked ? '[x]' : '[ ]'}
      </Text>
      <Text style={[styles.checkboxLabel, disabled && styles.textDisabled]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    backgroundColor: '#2c2c2e',
    borderColor: '#48484a',
    borderRadius: 4,
    borderWidth: 1,
    margin: 2,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  buttonDisabled: {
    backgroundColor: '#1c1c1e',
  },
  buttonText: {
    color: '#e5e5ea',
    fontSize: 12,
  },
  checkbox: {
    alignItems: 'center',
    flexDirection: 'row',
    marginRight: 12,
    paddingVertical: 4,
  },
  checkboxBox: {
    color: '#e5e5ea',
    fontFamily: 'monospace',
    fontSize: 13,
    marginRight: 4,
  },
  checkboxLabel: {
    color: '#e5e5ea',
    fontSize: 13,
  },
  textDisabled: {
    color: '#636366',
  },
});
