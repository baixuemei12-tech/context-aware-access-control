import Chart from 'chart.js/auto';
import config from '../../js/config.js?raw';
import common from '../../js/common.js?raw';
import visuals from '../../js/visuals.js?raw';
import admin from '../../js/admin.js?raw';
import { runLegacyStack } from '../legacy/run-legacy.js';

window.Chart = Chart;

runLegacyStack([
  ['js/config.js', config],
  ['js/common.js', common],
  ['js/visuals.js', visuals],
  ['js/admin.js', admin]
]);
