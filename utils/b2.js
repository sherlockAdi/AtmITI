const B2 = require('backblaze-b2');
const config = require('../config');

const b2Client = new B2({
  applicationKeyId: config.b2.accessKeyId,
  applicationKey: config.b2.secretAccessKey,
});

let authorized = false;

async function ensureAuthorized() {
  if (!authorized) {
    await b2Client.authorize();
    authorized = true;
  }
}

async function uploadFile(buffer, fileName, mimeType) {
  await ensureAuthorized();
  
  // Get upload URL
  const { data: { uploadUrl, authorizationToken } } = await b2Client.getUploadUrl({
    bucketId: await getBucketId()
  });
  
  // Upload file
  const res = await b2Client.uploadFile({
    uploadUrl,
    uploadAuthToken: authorizationToken,
    fileName,
    data: buffer,
    mime: mimeType,
  });
  
  return res.data;
}

async function getFileStream(fileName) {
  await ensureAuthorized();
  
  const { data } = await b2Client.downloadFileByName({
    bucketName: config.b2.bucket,
    fileName,
    responseType: 'stream',
  });
  
  return data;
}

async function getBucketId() {
  await ensureAuthorized();
  
  const { data } = await b2Client.listBuckets();
  const bucket = data.buckets.find(b => b.bucketName === config.b2.bucket);
  
  if (!bucket) {
    throw new Error('Bucket not found');
  }
  
  return bucket.bucketId;
}

async function getPublicFileUrl(fileName) {
  return `https://f000.backblazeb2.com/file/${config.b2.bucket}/${fileName}`;
}

module.exports = { 
  uploadFile, 
  getFileStream, 
  getPublicFileUrl 
};