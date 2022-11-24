import logging
import time
import uuid
import os

import azure.functions as func
from azure.cognitiveservices.vision.computervision import ComputerVisionClient
from msrest.authentication import CognitiveServicesCredentials
from azure.cognitiveservices.vision.computervision.models import OperationStatusCodes
from azure.cosmos import CosmosClient


# Azure Computer Vision Authentication
computervision_client = ComputerVisionClient(os.environ["computervision_endpoint"], 
                                             CognitiveServicesCredentials(os.environ["computervision_subscription_key"]))

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


# Format the text data as a dictionary mapping macronutrients to quantities
def preprocess(input):        
    # The nutrition_info dictionary is initialized with an id field required to write it to CosmosDB
    nutrition_info = {'id' : str(uuid.uuid4())}

    desired_fields = ['Calories', 'Total Fat', 'Cholesterol', 'Sodium',
                      'Total Carbohydrate', 'Dietary Fiber', 'Total Sugars', 'Protein']
    
    # Iterate through OCR result and extract desired nutrition label fields
    for text_result in input:
        for i, line in enumerate(text_result.lines):
            for desired_field in desired_fields:
                if desired_field in line.text: 
                    try:    
                        # Azure OCR returns calorie value on next line 
                        if desired_field == 'Calories':
                            nutrition_info[desired_field] = float(text_result.lines[i+1].text)
                        else:
                            # Remove units
                            value = line.text.split()[-1]
                            value_no_units = value.replace('mg', '').replace('g', '')
                            
                            # Azure OCR occasionally picks up zeroes as 'O' characters
                            if value_no_units == 'O':
                                value_no_units = 0.0
                            
                            nutrition_info[desired_field] = float(value_no_units)
                            logging.info(f"Found field {desired_field} with value {nutrition_info[desired_field]}.")
                    
                    except Exception as e:
                        logging.error(f"Error finding value for field {desired_field}: {e}")
    
    return nutrition_info


# Use OCR to extract all text from the image
def perform_ocr(blob_uri):
    # Call API with URL and raw response (allows you to get the operation location)
    read_response = computervision_client.read(blob_uri, raw=True)

    # Get the operation location (URL with an ID at the end) from the response
    read_operation_location = read_response.headers["Operation-Location"]

    # Grab the ID from the URL
    operation_id = read_operation_location.split("/")[-1]

    # Call the "GET" API and wait for it to retrieve the results 
    while True:
        read_result = computervision_client.get_read_result(operation_id)
        if read_result.status not in ['notStarted', 'running']:
            break
        time.sleep(0.1)

    logging.info(f"OCR Response Status: {read_result.status}.")
    return read_result


def main(myblob: func.InputStream):
    logging.info(f"Python blob trigger OCR function started processing blob {myblob.name}\n")

    # Perform OCR
    read_result = perform_ocr(myblob.uri)    
    
    # If OCR is successful, preprocess result and write to CosmosDB
    if read_result.status == OperationStatusCodes.succeeded:
        nutrition_data = preprocess(read_result.analyze_result.read_results)
        
        # Only write to DB if any macronutrient data is extracted (picture is actually of nutrition label)
        if len(nutrition_data) > 1:
            nutrition_data['timestamp'] = read_result.created_date_time
            db_write(nutrition_data)
            logging.info(f"OCR function finished processing blob {myblob.name}!\n")
    else:
        logging.error(f"OCR function error on blob {myblob.name} with status {read_result.status}")