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

const computeDateRange = dates => {
  // Convert range of dates from local time to UTC.

  // offset between local time and UTC time
  const hoursOffset = new Date().getTimezoneOffset() / 60;

  // convert selected local dates into Date objects
  var startDate = dates.startDate;
  startDate = new Date(startDate.slice(0,10) + "T00:00:00.000Z");

  var endDate = dates.endDate;
  endDate = new Date(endDate.slice(0,10) + "T00:00:00.000Z");

  // increment end date by 1 so that SQL query includes data from last day in range
  endDate.setDate(endDate.getDate() + 1);

  // convert local time to UTC time
  startDate.setHours(startDate.getHours() + hoursOffset);
  endDate.setHours(endDate.getHours() + hoursOffset);

  // return strings in ISO format
  startDate = startDate.toISOString();
  endDate = endDate.toISOString();

  // remove decimal on seconds to match database timestamp format
  startDate = startDate.slice(0,19) + "Z";
  endDate = endDate.slice(0,19) + "Z";
  
  return {startDateUTC: startDate, endDateUTC: endDate};
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
  // extract local dates from UI
  const dateRange = req.body.dates.split(" ");
  const startDateLocal = new Date(dateRange[0]);
  const endDateLocal = new Date(dateRange[2]);
  const dates = {startDate: startDateLocal.toISOString(), 
                 endDate: endDateLocal.toISOString()}

  // convert local dates to UTC
  const {startDateUTC, endDateUTC} = computeDateRange(dates)

  // Create database if it doesn't exist
  const { database } = await cosmosClient.databases.createIfNotExists({id:'nutrition_database'});

  // Create container if it doesn't exist
  const { container } = await database.containers.createIfNotExists({
    id: 'nutrition_data',
    partitionKey: {
        paths: ["/id"]
    }
  });

  // database query gets totals for all macronutrients in chosen range
  const querySpec = {
    query: `select 
            sum(d['Calories']), 
            sum(d['Total Fat']), 
            sum(d['Cholesterol']), 
            sum(d['Sodium']), 
            sum(d['Total Carbohydrate']), 
            sum(d['Dietary Fiber']), 
            sum(d['Total Sugars']), 
            sum(d['Protein']) 
            from nutrition_data d 
            where d.timestamp >= '` + startDateUTC + "' and d.timestamp < '" + endDateUTC + "'",
  };

  const { resources } = await container.items.query(querySpec).fetchAll();

  // also compute daily averages over selected range
  const numDays = Math.floor((endDateLocal.getTime() - startDateLocal.getTime()) / (1000 * 3600 * 24)) + 1;
  var resourceAverages = {};
  for(const [key, value] of Object.entries(resources[0])){
    resourceAverages[key] = value/numDays;
  }

  // render results
  res.render('cosmosSuccess', { message: 'Nutrition data retrieved from CosmosDB.', 
                                resources: resources[0],
                                resourceAverages,
                                startDate: dateRange[0],
                                endDate: dateRange[2]
                              });
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