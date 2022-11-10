if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const {
  BlobServiceClient,
  StorageSharedKeyCredential,
  newPipeline
} = require('@azure/storage-blob');
const { CosmosClient } = require('@azure/cosmos');

const express = require('express');
const router = express.Router();
const multer = require('multer');
const inMemoryStorage = multer.memoryStorage();
const uploadStrategy = multer({ storage: inMemoryStorage }).single('image');
const getStream = require('into-stream');
const ONE_MEGABYTE = 1024 * 1024;
const uploadOptions = { bufferSize: 4 * ONE_MEGABYTE, maxBuffers: 20 };

const sharedKeyCredential = new StorageSharedKeyCredential(
  process.env.AZURE_STORAGE_ACCOUNT_NAME,
  process.env.AZURE_STORAGE_ACCOUNT_ACCESS_KEY);
const pipeline = newPipeline(sharedKeyCredential);

const blobServiceClient = new BlobServiceClient(
  `https://${process.env.AZURE_STORAGE_ACCOUNT_NAME}.blob.core.windows.net`,
  pipeline
);

const cosmosClient = new CosmosClient({
  endpoint: process.env.COSMOS_ENDPOINT,
  key: process.env.COSMOS_KEY
});

const getBlobName = originalName => {
  // Use a random number to generate a unique file name, 
  // removing "0." from the start of the string.
  const identifier = Math.random().toString().replace(/0\./, '');
  return `${identifier}-${originalName}`;
};

router.get('/', async (req, res, next) => {
  let viewData;
  viewData = {
      title: 'Home',
      viewName: 'index',
  };
  res.render(viewData.viewName, viewData);
});

router.post('/upload-label-image', uploadStrategy, async (req, res) => {
  const blobName = getBlobName(req.file.originalname);
  const stream = getStream(req.file.buffer);
  const containerClient = blobServiceClient.getContainerClient('label-images');;
  const blockBlobClient = containerClient.getBlockBlobClient(blobName);

  try {
    await blockBlobClient.uploadStream(stream,
      uploadOptions.bufferSize, uploadOptions.maxBuffers,
      { blobHTTPHeaders: { blobContentType: "image/jpeg" } });
    res.render('success', { message: 'Nutrition label uploaded to Azure Blob Storage.' });
  } catch (err) {
    res.render('error', { message: err.message });
  }
});

router.post('/fetch-nutrition-data', async (req, res) => {
  const hours_offset = new Date().getTimezoneOffset() / 60;
  const date_range = req.body.dates.split(" ");
  const start_date = new Date(date_range[0]).toISOString();
  const end_date = new Date(date_range[2]).toISOString();
  console.log("start date", start_date);
  console.log("end date", end_date);

  // Create database if it doesn't exist
  const { database } = await cosmosClient.databases.createIfNotExists({id:'nutrition_database'});
  console.log(`${database.id} database ready`);

  // Create container if it doesn't exist
  const { container } = await database.containers.createIfNotExists({
    id: 'nutrition_data',
    partitionKey: {
        paths: ["/id"]
    }
  });
  console.log(`${container.id} container ready`);

  const querySpec = {
    query: "select * from nutrition_data d where d.timestamp > '" + start_date + "' and d.timestamp < '" + end_date + "'",
  };

  // Get items 
  const { resources } = await container.items.query(querySpec).fetchAll();
  for (const item of resources) {
    console.log(`${item['Total Fat']}`);
  }

  res.render('success', { message: 'Your request was successful!' });
});


router.post('/upload-food-image', uploadStrategy, async (req, res) => {
  const blobName = getBlobName(req.file.originalname);
  const stream = getStream(req.file.buffer);
  const containerClient = blobServiceClient.getContainerClient('food-images');;
  const blockBlobClient = containerClient.getBlockBlobClient(blobName);

  try {
    await blockBlobClient.uploadStream(stream,
      uploadOptions.bufferSize, uploadOptions.maxBuffers,
      { blobHTTPHeaders: { blobContentType: "image/jpeg" } });
    res.render('success', { message: 'Food image uploaded to Azure Blob Storage.' });
  } catch (err) {
    res.render('error', { message: err.message });
  }
});

module.exports = router;