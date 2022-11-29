import os

# This file renames files of certain output classes to return more accurate results from the Nutrition API
# This file should be run once before training the model
 
base_location = os.path.join(os.path.dirname(__file__), "images/train")

new_class_names = {'Apple Granny Smith': 'Granny Smith Apple',
                   'Apple Braeburn': 'Braeburn Apple',
                   'Pepper Green': 'Green Pepper',
                   'Pepper Red': 'Red Pepper',
                   'Potato Red': 'Red Potato',
                   'Onion White': 'White Onion',
                   'Grape Blue': 'Blue Grape',
                   'Limes': 'Lime'}

for dir in os.scandir(base_location):
    class_name = dir.name
    
    if class_name in new_class_names:
        new_class_name = new_class_names[class_name]
        new_path = os.path.join(os.path.dirname(__file__), f"images/train/{new_class_name}")
        os.rename(dir, new_path)
        
        for i, filename in enumerate(os.listdir(new_path)):
            os.rename(new_path + "/" + filename, new_path + "/" + new_class_name + '_' + str(i) + ".jpg")
            
        print(f"Successfully preprocessed {class_name} class!")

print("Done!")
