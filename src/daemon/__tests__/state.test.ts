import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DaemonState } from '../state.js';
import type { ProjectState } from '../../shared/protocol.js';

describe('daemon/state', () => {
  let state: DaemonState;

  beforeEach(() => {
    state = new DaemonState();
  });

  describe('initial state', () => {
    it('has default values', () => {
      expect(state.current).toEqual({
        initialized: false,
        daemonOnline: false,
        workState: 'stopped',
      });
    });

    it('accepts initial overrides', () => {
      const s = new DaemonState({ initialized: true, workState: 'working' });

      expect(s.current).toEqual({
        initialized: true,
        daemonOnline: false,
        workState: 'working',
      });
    });
  });

  describe('update', () => {
    it('updates a single field', () => {
      state.update({ initialized: true });

      expect(state.current.initialized).toBe(true);
      expect(state.current.daemonOnline).toBe(false);
    });

    it('updates multiple fields at once', () => {
      state.update({ initialized: true, daemonOnline: true, workState: 'working' });

      expect(state.current).toEqual({
        initialized: true,
        daemonOnline: true,
        workState: 'working',
      });
    });

    it('returns a snapshot copy (not a reference)', () => {
      const snap1 = state.current;
      state.update({ initialized: true });
      const snap2 = state.current;

      expect(snap1.initialized).toBe(false);
      expect(snap2.initialized).toBe(true);
    });
  });

  describe('change detection', () => {
    it('notifies listeners on change', () => {
      const listener = vi.fn();
      state.onChange(listener);

      state.update({ initialized: true });

      expect(listener).toHaveBeenCalledOnce();
      expect(listener).toHaveBeenCalledWith({
        initialized: true,
        daemonOnline: false,
        workState: 'stopped',
      });
    });

    it('does not notify when value is unchanged', () => {
      const listener = vi.fn();
      state.onChange(listener);

      state.update({ initialized: false }); // same as default

      expect(listener).not.toHaveBeenCalled();
    });

    it('supports multiple listeners', () => {
      const l1 = vi.fn();
      const l2 = vi.fn();
      state.onChange(l1);
      state.onChange(l2);

      state.update({ workState: 'working' });

      expect(l1).toHaveBeenCalledOnce();
      expect(l2).toHaveBeenCalledOnce();
    });

    it('unsubscribe removes listener', () => {
      const listener = vi.fn();
      const unsub = state.onChange(listener);

      unsub();
      state.update({ initialized: true });

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('convenience setters', () => {
    it('setInitialized triggers change', () => {
      const listener = vi.fn();
      state.onChange(listener);

      state.setInitialized(true);

      expect(state.current.initialized).toBe(true);
      expect(listener).toHaveBeenCalledOnce();
    });

    it('setOnline triggers change', () => {
      const listener = vi.fn();
      state.onChange(listener);

      state.setOnline(true);

      expect(state.current.daemonOnline).toBe(true);
      expect(listener).toHaveBeenCalledOnce();
    });

    it('setWorkState triggers change', () => {
      const listener = vi.fn();
      state.onChange(listener);

      state.setWorkState('awaiting');

      expect(state.current.workState).toBe('awaiting');
      expect(listener).toHaveBeenCalledOnce();
    });
  });

  describe('state transitions', () => {
    it('tracks full lifecycle: stopped → working → awaiting → stopped', () => {
      const states: ProjectState[] = [];
      state.onChange((s) => states.push(s));

      state.setWorkState('working');
      state.setWorkState('awaiting');
      state.setWorkState('stopped');

      expect(states).toHaveLength(3);
      expect(states[0].workState).toBe('working');
      expect(states[1].workState).toBe('awaiting');
      expect(states[2].workState).toBe('stopped');
    });
  });
});
