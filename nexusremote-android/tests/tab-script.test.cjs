const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../app/src/main/java/za/nexusremote/portal/MainActivity.java'),'utf8');
const expression=source.match(/browser\.evaluateJavascript\(("(?:\\.|[^"\\])*"\+tab\+"(?:\\.|[^"\\])*")/)[1];
const [left,right]=expression.split('+tab+').map(JSON.parse);
for(const tab of ['home','apply','worker','owner']) {
  test(`native ${tab} tab sends a usable selector and clicks its target`,()=>{
    let selector;
    let clicked=false;
    const result=vm.runInNewContext(left+tab+right,{document:{querySelector(value){selector=value; return {click(){clicked=true;}};}}});
    assert.equal(selector,`[data-tab="${tab}"]`);
    assert.equal(clicked,true);
    assert.equal(result,true);
  });
}
test('missing portal tab produces false for native error handling',()=>{
  assert.equal(vm.runInNewContext(left+'home'+right,{document:{querySelector(){return null;}}}),false);
});
