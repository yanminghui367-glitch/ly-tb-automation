// Isolated HTTP fixture. No browser is launched and no production DB is opened.
import {workbenchServer} from '../server.mjs';
await new Promise(resolve=>workbenchServer.listen(Number(process.env.SHOP_FIXTURE_PORT)||0,'127.0.0.1',resolve));
process.send?.({port:workbenchServer.address().port});
