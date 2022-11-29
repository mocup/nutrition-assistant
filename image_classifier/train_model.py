from azure.cognitiveservices.vision.customvision.training import CustomVisionTrainingClient
from azure.cognitiveservices.vision.customvision.training.models import ImageFileCreateBatch, ImageFileCreateEntry
from msrest.authentication import ApiKeyCredentials
import os, time, uuid
from dotenv import load_dotenv

load_dotenv()
training_endpoint = os.environ["training_endpoint"]
training_key = os.environ["training_key"]
prediction_resource_id = os.environ["prediction_resource_id"]

# Create vision training client
training_credentials = ApiKeyCredentials(in_headers={"Training-key": training_key})
trainer = CustomVisionTrainingClient(training_endpoint, training_credentials)


def create_project():
    # Create a new project
    print ("Creating project...")
    project_name = uuid.uuid4()
    project = trainer.create_project(project_name)
    return project


def upload_images(project):
    base_image_location = os.path.join(os.path.dirname(__file__), "images/train")

    # Add tags and map each class to its tag
    model_classes = [f.name for f in os.scandir(base_image_location) if f.is_dir() ]
    
    class_tag_mapping = {}
    for model_class in model_classes:
        tag = trainer.create_tag(project.id, model_class)
        class_tag_mapping[model_class] = tag

    # Upload images
    print("Adding images...")

    # Max 64 images per batch
    IMAGES_PER_CLASS = 64
    for model_class, tag in class_tag_mapping.items():   
        # BATCH 1
        image_list = []
        
        for image_num in range(1, IMAGES_PER_CLASS + 1):
            file_name = f"{model_class}_{image_num}.jpg"
            with open(os.path.join (base_image_location, model_class, file_name), "rb") as image_contents:
                image_list.append(ImageFileCreateEntry(name=file_name, contents=image_contents.read(), tag_ids=[tag.id]))
    
        upload_result = trainer.create_images_from_files(project.id, ImageFileCreateBatch(images=image_list))
        if not upload_result.is_batch_successful:
            print(f"Batch 1 upload failed for {model_class} class")
            for image in upload_result.images:
                print("Image status: ", image.status)
            exit(-1)
        else:
            print(f"Batch 1 upload successful for {model_class} class")
                
        # BATCH 2
        image_list = []
        
        for image_num in range(IMAGES_PER_CLASS + 1, 2 * IMAGES_PER_CLASS + 1):
            file_name = f"{model_class}_{image_num}.jpg"
            with open(os.path.join (base_image_location, model_class, file_name), "rb") as image_contents:
                image_list.append(ImageFileCreateEntry(name=file_name, contents=image_contents.read(), tag_ids=[tag.id]))
    
        upload_result = trainer.create_images_from_files(project.id, ImageFileCreateBatch(images=image_list))
        if not upload_result.is_batch_successful:
            print(f"Batch 2 upload failed for {model_class} class")
            for image in upload_result.images:
                print("Image status: ", image.status)
            exit(-1)
        else:
            print(f"Batch 2 upload successful for {model_class} class")


def train_model(project):    
    # Train model
    print ("Training...")
    iteration = trainer.train_project(project.id)
    while (iteration.status != "Completed"):
        iteration = trainer.get_iteration(project.id, iteration.id)
        print ("Training status: " + iteration.status)
        print ("Waiting 10 seconds...")
        time.sleep(10)

    # The iteration is now trained. Publish it to the project endpoint
    publish_iteration_name = "classifyModel"
    trainer.publish_iteration(project.id, iteration.id, publish_iteration_name, prediction_resource_id)
    print ("Done!")
    
    
if __name__ == "__main__":
    project = create_project()
    upload_images(project)
    train_model(project)
    