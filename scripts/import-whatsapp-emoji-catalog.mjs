import fs from 'node:fs/promises';
const response=await fetch('https://unicode.org/Public/emoji/16.0/emoji-test.txt',{signal:AbortSignal.timeout(30000)});
if(!response.ok)throw Error('Unicode catalog unavailable');
const source=await response.text();
if(!source.includes('# Version: 16.0'))throw Error('Unexpected Unicode version');
const groups={'Smileys & Emotion':'smileys','People & Body':'smileys','Animals & Nature':'nature','Food & Drink':'food','Travel & Places':'travel','Activities':'activities','Objects':'work','Symbols':'hearts','Flags':'flags'};
let group='';const catalog=[];
for(const line of source.split('\n')) {
  if(line.startsWith('# group: '))group=groups[line.slice(9).trim()];
  const match=line.match(/^([0-9A-F ]+)\s*; fully-qualified\s*# \S+ E[0-9.]+ (.+)$/);
  if(match && group)catalog.push({emoji:String.fromCodePoint(...match[1].trim().split(/\s+/).map(code=>parseInt(code,16))),words:match[2],category:group});
}
if(catalog.length<3500)throw Error('Incomplete Unicode catalog');
const path='src/modules/whatsapp/emoji-assets.json';
const manifest=JSON.parse(await fs.readFile(path,'utf8'));
await fs.mkdir('public/whatsapp-emojis',{recursive:true});
const queue=catalog.filter(item=>!manifest[item.emoji]);let imported=0;const failures=[];
const key=emoji=>Array.from(emoji,ch=>ch.codePointAt(0).toString(16).padStart(6,'0')).join('_');
await Promise.all(Array.from({length:12},async()=>{
  while(queue.length) {
    const item=queue.shift(), filename=key(item.emoji)+'.png';let bytes;
    for(const candidate of [...new Set([item.emoji,item.emoji.replaceAll('\ufe0f','')])]) {
      try {const asset=await fetch('https://web.whatsapp.com/emoji/v1/16/0/2/single/w/64/'+key(candidate)+'.png',{signal:AbortSignal.timeout(15000)});
        if(asset.ok && asset.headers.get('content-type')?.startsWith('image/png')) {const data=new Uint8Array(await asset.arrayBuffer());if(data[0]===137 && data[1]===80 && data[2]===78 && data[3]===71){bytes=data;break;}}
      }catch{/* retain existing assets and omit artwork that could not be verified */}
    }
    if(!bytes){failures.push(item.emoji);continue;}
    await fs.writeFile('public/whatsapp-emojis/'+filename,bytes);manifest[item.emoji]=filename;imported++;
    if(imported%250===0)console.log({imported});
  }
}));
await fs.writeFile(path,JSON.stringify(manifest,null,2)+'\n');
await fs.writeFile('src/modules/whatsapp/emoji-catalog.json',JSON.stringify(catalog.filter(item=>manifest[item.emoji]))+'\n');
console.log({total:catalog.length,verified:catalog.filter(item=>manifest[item.emoji]).length,imported,unavailable:failures.length});
