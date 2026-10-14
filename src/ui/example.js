const DEMO_CODE=`const box=dv.el('div','');
const label=box.createEl('label',{text:'增长率：'});
const slider=box.createEl('input',{type:'range'});slider.min='0';slider.max='30';slider.value='8';
const output=box.createEl('strong');const bars=box.createEl('div');
function draw(){output.textContent=slider.value+'%';bars.replaceChildren();for(let year=0;year<6;year++){const value=100*Math.pow(1+Number(slider.value)/100,year);const row=bars.createEl('div');row.style.margin='8px 0';row.textContent='第 '+year+' 年：'+value.toFixed(1);const bar=row.createEl('div');bar.style.cssText='height:12px;border-radius:4px;background:var(--interactive-accent);width:'+Math.min(value/4,100)+'%';}}
slider.addEventListener('input',draw);draw();`;
module.exports={DEMO_CODE};
