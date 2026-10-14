const {PluginSettingTab,Setting}=require('obsidian');
class Settings extends PluginSettingTab {
  constructor(app,p){super(app,p);this.p=p;}
  display(){const c=this.containerEl;c.empty();c.createEl('h2',{text:'VaultBridge · OpenCode'});
    c.createEl('p',{text:'使用独立 OpenCode 服务。安装 OpenCode 后填写可执行文件路径；API Key 只保留在本次 Obsidian 进程内，也可复用 OpenCode 已配置的凭据。修改设置后先断开再连接。'});
    for(const [key,label] of [['executable','OpenCode 可执行文件'],['provider','供应商 ID'],['model','模型 ID'],['baseURL','API Base URL'],['artifactFolder','成果保存目录']])new Setting(c).setName(label).addText(t=>t.setValue(this.p.settings[key]).onChange(async v=>{this.p.settings[key]=v.trim();await this.p.persist();}));
    new Setting(c).setName('API Key（本次运行）').addText(t=>{t.inputEl.type='password';t.setValue(this.p.apiKey||'').onChange(v=>this.p.apiKey=v.trim());});
    new Setting(c).setName('服务').addButton(b=>b.setButtonText('连接').onClick(()=>this.p.connect().catch(e=>this.p.fail(e)))).addButton(b=>b.setButtonText('断开').onClick(()=>this.p.disconnect().catch(e=>this.p.fail(e))));
  }
}
module.exports={Settings};
