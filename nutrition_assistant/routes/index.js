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

const sharedKeyCredentialLabel = new StorageSharedKeyCredential(
  process.env.AZURE_STORAGE_ACCOUNT_LABEL_NAME,
  process.env.AZURE_STORAGE_ACCOUNT_LABEL_ACCESS_KEY);
const labelPipeline = newPipeline(sharedKeyCredentialLabel);

const sharedKeyCredentialFood = new StorageSharedKeyCredential(
  process.env.AZURE_STORAGE_ACCOUNT_FOOD_NAME,
  process.env.AZURE_STORAGE_ACCOUNT_FOOD_ACCESS_KEY);
const foodPipeline = newPipeline(sharedKeyCredentialFood);

const labelBlobServiceClient = new BlobServiceClient(
  `https://${process.env.AZURE_STORAGE_ACCOUNT_LABEL_NAME}.blob.core.windows.net`,
  labelPipeline
);

const foodBlobServiceClient = new BlobServiceClient(
  `https://${process.env.AZURE_STORAGE_ACCOUNT_FOOD_NAME}.blob.core.windows.net`,
  foodPipeline
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
  //const hoursOffset = new Date().getTimezoneOffset() / 60;

  // convert selected local dates into Date objects
  var startDate = dates.startDate;
  startDate = new Date(startDate.slice(0,10) + "T00:00:00.000Z");

  var endDate = dates.endDate;
  endDate = new Date(endDate.slice(0,10) + "T00:00:00.000Z");

  // increment end date by 1 so that SQL query includes data from last day in range
  endDate.setDate(endDate.getDate() + 1);

  // convert local time to UTC time
  // startDate.setHours(startDate.getHours() + hoursOffset);
  // endDate.setHours(endDate.getHours() + hoursOffset);

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
  // upload nutrition label image into blob store
  const blobName = getBlobName(req.file.originalname);
  const stream = getStream(req.file.buffer);
  const containerClient = labelBlobServiceClient.getContainerClient('label-images');;
  const blockBlobClient = containerClient.getBlockBlobClient(blobName);
  const mimeType = req.file.mimetype;
  
  // check mimetype
  if (!mimeType.startsWith('image/')) {
    return res.render('error', { message: "Only image file types are supported."});
  }

  try {
    await blockBlobClient.uploadStream(stream,
      uploadOptions.bufferSize, uploadOptions.maxBuffers,
      { blobHTTPHeaders: { blobContentType: "image/jpeg" } });
    res.render('success', { message: 'Nutrition label image ' + req.file.originalname + ' was uploaded to Azure Blob Storage.' });
  } catch (err) {
    res.render('error', { message: err.message });
  }
});

router.post('/fetch-nutrition-data', async (req, res) => {
  // get nutrition data in specified date range from cosmos db
  // extract local dates from UI
  const dateRange = req.body.dates.split(" ");
  const startDateLocal = new Date(dateRange[0]);
  const endDateLocal = new Date(dateRange[2]);
  const dates = {startDate: startDateLocal.toISOString(), 
                 endDate: endDateLocal.toISOString()}

  // convert local dates to UTC
  const {startDateUTC, endDateUTC} = computeDateRange(dates)

  // access nutrition data container
  const container = cosmosClient.database("nutrition_database").container("nutrition_data");

  // database query gets totals for all macronutrients in chosen range
  const macronutrientQuerySpec = {
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
            where TimestampToDateTime(d['_ts']*1000) >= '` + startDateUTC + 
            "' and TimestampToDateTime(d['_ts']*1000) < '" + endDateUTC + "'",
  };

  const { resources: macronutrients } = await container.items.query(macronutrientQuerySpec).fetchAll();

  // also compute daily averages over selected range
  const numDays = Math.floor((endDateLocal.getTime() - startDateLocal.getTime()) / (1000 * 3600 * 24)) + 1;
  var macronutrientAverages = {};
  for(const [key, value] of Object.entries(macronutrients[0])){
    // round total values and average values to two decimal places
    macronutrients[0][key] = value.toFixed(2);
    macronutrientAverages[key] = (value/numDays).toFixed(2);
  }

  // database query gets food predictions and probabilities in chosen range
  const classifierQuerySpec = {
    query: `select
            d['timestamp'],
            d['prediction'],
            d['probability']
            from nutrition_data d 
            where TimestampToDateTime(d['_ts']*1000) >= '` + startDateUTC  + 
            "' and TimestampToDateTime(d['_ts']*1000) < '" + endDateUTC + "'",
  };

  var { resources: predictions } = await container.items.query(classifierQuerySpec).fetchAll();

  // only include non-empty predictions in table
  predictions = predictions.filter(element => {
    if (Object.keys(element).length > 1) {
      const date = new Date(element['timestamp']);
      const hoursOffset = new Date().getTimezoneOffset() / 60;
      date.setHours(date.getHours() - hoursOffset);
      element['timestamp'] = date.toLocaleString();
      return true;
    }
  
    return false;
  });
  
  // render results
  res.render('cosmosSuccess', { message: 'Nutrition data retrieved from CosmosDB.', 
                                macronutrients: macronutrients[0],
                                macronutrientAverages,
                                predictions,
                                startDate: dateRange[0],
                                endDate: dateRange[2]
                              });
});

router.post('/upload-food-image', uploadStrategy, async (req, res) => {
  // upload food image into blob store
  const blobName = getBlobName(req.file.originalname);
  const stream = getStream(req.file.buffer);
  const containerClient = foodBlobServiceClient.getContainerClient('food-images');;
  const blockBlobClient = containerClient.getBlockBlobClient(blobName);
  const mimeType = req.file.mimetype;
  
  // check mimetype
  if (!mimeType.startsWith('image/')) {
    return res.render('error', { message: "Only image file types are supported."});
  }

  try {
    await blockBlobClient.uploadStream(stream,
      uploadOptions.bufferSize, uploadOptions.maxBuffers,
      { blobHTTPHeaders: { blobContentType: "image/jpeg" } });
    res.render('success', { message: 'Food image ' + req.file.originalname + ' was uploaded to Azure Blob Storage.' });
  } catch (err) {
    res.render('error', { message: err.message });
  }
});

module.exports = router;