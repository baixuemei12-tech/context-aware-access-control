import '../../css/dynamic-fx.css';
import qrCode from '../../js/vendor/qrcode.min.js?raw';
import qrFallback from '../../js/vendor/qrcode-fallback.js?raw';
import config from '../../js/config.js?raw';
import common from '../../js/common.js?raw';
import visuals from '../../js/visuals.js?raw';
import i18n from '../../js/i18n.js?raw';
import profile from '../../js/profile.js?raw';
import dynamicFx from '../../js/dynamic-fx.js?raw';
import { runLegacyStack } from '../legacy/run-legacy.js';

runLegacyStack([
  ['js/vendor/qrcode.min.js', qrCode],
  ['js/vendor/qrcode-fallback.js', qrFallback],
  ['js/config.js', config],
  ['js/common.js', common],
  ['js/visuals.js', visuals],
  ['js/i18n.js', i18n],
  ['js/profile.js', profile],
  ['js/dynamic-fx.js', dynamicFx]
]);
