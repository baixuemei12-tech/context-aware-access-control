import '../styles/file-icons.css';
import config from '../../js/config.js?raw';
import common from '../../js/common.js?raw';
import visuals from '../../js/visuals.js?raw';
import context from '../../js/context.js?raw';
import dashboard from '../../js/dashboard.js?raw';
import { runLegacyStack } from '../legacy/run-legacy.js';

runLegacyStack([
  ['js/config.js', config],
  ['js/common.js', common],
  ['js/visuals.js', visuals],
  ['js/context.js', context],
  ['js/dashboard.js', dashboard]
]);
