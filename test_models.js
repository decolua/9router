const ModelRouter = require('./src/orchestrator/modelRouter.js');

const mr = new ModelRouter();
const best = mr.getBestFreeModel('chat');
console.log('Best free model:', best ? `${best.provider}/${best.id}` : 'none');

const bestPaid = mr.getBestModelForTask('code', { preferFree: false });
console.log('Best paid model:', bestPaid ? `${bestPaid.provider}/${bestPaid.id}` : 'none');

console.log('--- Summary by type ---');
for (const type of Object.keys(mr.config.modelGroups)) {
  const m = mr.getBestModelForTask(type);
  console.log(`${type}: ${m ? `${m.provider}/${m.id}` : 'none'}`);
}