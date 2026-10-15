import assert from "node:assert/strict";
import net from "node:net";
const url=process.env.STORAGE_URL??"http://localhost:9000";
const id=crypto.randomUUID();
const data=new Uint8Array(2*1024*1024).fill(89);
const endpoint=url+"/v1/chunks/"+id;
assert.equal((await fetch(endpoint,{method:"PUT",body:data})).status,201);
assert.deepEqual(new Uint8Array(await (await fetch(endpoint)).arrayBuffer()),data);
const target=new URL(url),aborted=crypto.randomUUID();
await new Promise((resolve,reject)=>{
  const socket=net.connect(Number(target.port),target.hostname,()=>{
    socket.end("PUT /v1/chunks/"+aborted+" HTTP/1.1\r\nHost: localhost\r\nContent-Length: 1048576\r\n\r\npartial-body");
  });
  socket.on("error",reject);socket.on("close",resolve);socket.resume();
});
assert.equal((await fetch(url+"/v1/chunks/"+aborted)).status,404,"incomplete body must not create a chunk");
assert.equal((await fetch(endpoint,{method:"PUT",body:"overwrite"})).status,409);
assert.deepEqual(new Uint8Array(await (await fetch(endpoint)).arrayBuffer()),data);
await fetch(endpoint,{method:"DELETE"});
console.log("Large binary round trip, interrupted upload and immutable chunks passed.");
