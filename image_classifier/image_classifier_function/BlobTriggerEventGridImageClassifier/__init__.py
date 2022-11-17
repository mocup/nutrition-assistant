import logging
import os

import azure.functions as func
from azure.cognitiveservices.vision.customvision.prediction import CustomVisionPredictionClient
from msrest.authentication import ApiKeyCredentials

prediction_endpoint = os.environ["prediction_endpoint"]
prediction_key = os.environ["prediction_key"]
project_id = os.environ["project_id"]

prediction_credentials = ApiKeyCredentials(in_headers={"Prediction-key": prediction_key})
predictor = CustomVisionPredictionClient(prediction_endpoint, prediction_credentials)

def classify_image(blob_uri):    
    results = predictor.classify_image_url(project_id, "classifyModel", blob_uri)

    # Display the results.
    for prediction in results.predictions:
        print("\t" + prediction.tag_name +
              ": {0:.2f}%".format(prediction.probability * 100))

def main(myblob: func.InputStream):
    logging.info(f"Python blob trigger function processed blob {myblob.name}\n")

    classify_image(myblob.uri)
