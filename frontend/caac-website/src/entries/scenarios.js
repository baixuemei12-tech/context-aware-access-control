import '../../css/dynamic-fx.css';
import config from '../../js/config.js?raw';
import common from '../../js/common.js?raw';
import visuals from '../../js/visuals.js?raw';
import i18n from '../../js/i18n.js?raw';
import scenarios from '../../js/scenarios.js?raw';
import dynamicFx from '../../js/dynamic-fx.js?raw';
import { runLegacyStack } from '../legacy/run-legacy.js';

runLegacyStack([
  ['js/config.js', config],
  ['js/common.js', common],
  ['js/visuals.js', visuals],
  ['js/i18n.js', i18n],
  ['js/scenarios.js', scenarios],
  ['js/dynamic-fx.js', dynamicFx]
]);
