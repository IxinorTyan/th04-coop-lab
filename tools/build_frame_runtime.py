"""Generate a 60 Hz local presentation adapter without changing upstream WASM."""
from pathlib import Path
from optimize_np21_dispatch import optimize_dispatch
import hashlib,json
ROOT=Path(__file__).resolve().parents[1]
def build():
    vendor=ROOT/'web/vendor/np2'
    source=(vendor/'np21.js').read_text(encoding='utf-8')
    source=optimize_dispatch(source,vendor)
    old='var iterFunc=getWasmTableEntry(func);setMainLoop(iterFunc,fps,simulateInfiniteLoop)'
    assert source.count(old)==1,'Upstream main-loop anchor changed'
    new='var iterFunc=getWasmTableEntry(func);const frameDue=createFrameGate();setMainLoop(()=>{if(frameDue(performance.now())){Module.localFrameCount=(Module.localFrameCount||0)+1;iterFunc();}},fps,simulateInfiniteLoop)'
    source='import {createFrameGate} from "../../frame-limit.js";\n'+source.replace(old,new)
    (vendor/'np21-60.js').write_text(source,encoding='utf-8',newline='\n')
    manifest={'dispatch':'static-table-cache-v1','presentation_hz':60,'native_clock':'unchanged','wasm':'np21.wasm',
              'source_sha256':hashlib.sha256((vendor/'np21.js').read_bytes()).hexdigest(),
              'adapter_sha256':hashlib.sha256(source.encode()).hexdigest(),
              'frame_limit_sha256':hashlib.sha256((ROOT/'web/frame-limit.js').read_bytes()).hexdigest()}
    (vendor/'frame-runtime.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
    return manifest
if __name__=='__main__':
    build();print('Built NP21 local adapter: 60 Hz ceiling, original native elapsed-time simulation')
