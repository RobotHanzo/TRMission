// Re-export shim: the tutorial interaction gate lives with the shared tutorial types in
// @trm/client-core (this file was historically a hand-port of the web module).
export {
  gateFlags,
  gateAllowsTarget,
  type ActionGate,
  type ExpectSpec,
  type GateFlags,
} from '@trm/client-core/tutorial/types';
