// Production integration candidate. Not imported by the running server.
import {RoundManualSkip} from './round-manual-skip.mjs';
import {RoundItemApi} from './round-item-api.mjs';
import {RoundItemHostGuard} from './round-item-host.mjs';
import {RoundItemVerify} from './round-item-verify.mjs';
import {RoundItemRetry} from './round-item-retry.mjs';
export function createHostedRoundItemApi(product,options){
 const host=new RoundItemHostGuard(product,options);
 return new RoundItemApi(new RoundManualSkip(product.round),{host,verifier:new RoundItemVerify(host),retry:new RoundItemRetry(host)});
}
