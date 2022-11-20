import logging
import os
import requests
import uuid
import datetime

import azure.functions as func
from azure.cognitiveservices.vision.customvision.prediction import CustomVisionPredictionClient
from msrest.authentication import ApiKeyCredentials
from azure.cosmos import CosmosClient

prediction_endpoint = os.environ["prediction_endpoint"]
prediction_key = os.environ["prediction_key"]
project_id = os.environ["project_id"]
publish_iteration_name = os.environ["publish_iteration_name"]

# Azure Custom Vision client authentication
prediction_credentials = ApiKeyCredentials(in_headers={"Prediction-key": prediction_key})
predictor = CustomVisionPredictionClient(prediction_endpoint, prediction_credentials)

# Azure CosmosDB Authentication
cosmosdb_client = CosmosClient(url=os.environ["cosmosdb_endpoint"], 
                               credential=os.environ["cosmosdb_subscription_key"])


# Write nutrition data dictionary to the database
def db_write(nutrition_data):
    db_name, container_name = "nutrition_database", "nutrition_data"
    
    try:
        # Get database and container clients
        database = cosmosdb_client.get_database_client(db_name)
        container = database.get_container_client(container_name)
        
        # Insert nutrition data
        container.upsert_item(nutrition_data)
        logging.info(f"Successfully wrote {nutrition_data} item to {container_name} container in {db_name} database.")
    
    except Exception as e:
        logging.error(f"Error writing {nutrition_data} item to {container_name} container in {db_name} database!")
        logging.error(e)


def get_nutrition_data(prediction):
    # The nutrition_info dictionary is initialized with an id field required to write it to CosmosDB
    nutrition_info = {'id' : str(uuid.uuid4())}
    
    # Make call to API Ninjas Nutrition API for nutrition information given food prediction
    api_url = f"https://api.api-ninjas.com/v1/nutrition?query={prediction}"
    response = requests.get(api_url, headers={'X-Api-Key': os.environ["api_key"]})
    
    # If OK response, construct nutrition_info dictionary from response
    if response.status_code == requests.codes.ok:
        response_dict = response.json()[0]
        nutrition_info['Calories'] = response_dict['calories']
        nutrition_info['Total Fat'] = response_dict['fat_total_g']
        nutrition_info['Cholesterol'] = response_dict['cholesterol_mg']
        nutrition_info['Cholesterol'] = response_dict['cholesterol_mg']
        nutrition_info['Sodium'] = response_dict['sodium_mg']
        nutrition_info['Total Carbohydrate'] = response_dict['carbohydrates_total_g']
        nutrition_info['Dietary Fiber'] = response_dict['fiber_g']
        nutrition_info['Total Sugars'] = response_dict['sugar_g']
        nutrition_info['Protein'] = response_dict['protein_g']    
        logging.info(f"Successfully aggregated nutrition data!")
    else:
        logging.error(f"API Ninjas Nutrition API Error {response.status_code}: {response.text}")
    
    return nutrition_info


def classify_image(blob_uri):
    # Classify uploaded food image    
    results = predictor.classify_image_url(project_id, publish_iteration_name, blob_uri)

    # Display the results.
    for prediction in results.predictions:
        print("\t" + prediction.tag_name +
              ": {0:.2f}%".format(prediction.probability * 100))
        
    # Return top prediction
    return results.predictions[0]


def main(myblob: func.InputStream):
    logging.info(f"Python blob trigger function processed blob {myblob.name}\n")

    prediction = classify_image(myblob.uri)
    nutrition_data = get_nutrition_data(prediction.tag_name)
    
    # Only write to DB if (1) a prediction can be made and (2) nutrition data can be extracted
    if len(nutrition_data) > 1:
        nutrition_data['prediction'] = prediction.tag_name
        nutrition_data['probability'] = prediction.probability * 100
        nutrition_data['timestamp'] = datetime.datetime.utcnow().isoformat()
        db_write(nutrition_data)
    
