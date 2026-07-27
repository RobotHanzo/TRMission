/**
 * Swaps react-native-gesture-handler's native module for the JS mocks the library ships.
 *
 * Needed because a component may mount its OWN `GestureHandlerRootView` — the player card does,
 * inside its Modal, since on Android a modal is a separate native window that the app's root view
 * does not reach. That component calls `RNGestureHandlerModule.install()` on mount, which throws
 * under jest without this. `GestureDetector` alone never touched the native module, which is why
 * the suite got this far without it.
 */
require('react-native-gesture-handler/jestSetup');
