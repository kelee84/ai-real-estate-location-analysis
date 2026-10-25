'use strict';

function trustedMainSender(event,win,mainPage){
  if(!win||!event||event.sender!==win.webContents||!event.senderFrame||event.senderFrame!==win.webContents.mainFrame)return false;
  const url=event.senderFrame.url;
  // Anchor navigation keeps the same trusted document. Ignore only the
  // fragment; the exact scheme, host, path and query must still match.
  return typeof url==='string'&&url.split('#',1)[0]===mainPage;
}

module.exports={trustedMainSender};
