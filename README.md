# CS 5412 Final Project: Nutrition Assistant

## VIDEO: https://youtu.be/lqRh6MhoyS4
## REPORT: see "5412_Project_Final_Report.pdf" above

By Morgan Cupp and Berk Erdal

## Prerequisites
Clone the repository to your machine:
```bash
git clone https://github.com/baerdal/NutritionAssistant.git
```

Then, switch to the nutrition_assistant folder:

```bash
cd nutrition_assistant
```

Install dependencies via `npm`:

```bash
npm install
```

## Adding Azure Storage Accounts
Navigate to your storage account in the Azure and copy the account name and key (under **Settings** > **Access keys**) into the a new `.env` file. This project assumes you have two storage accounts, one with container `label-images` and the other `food-images`.
```
AZURE_STORAGE_ACCOUNT_LABEL_NAME=
AZURE_STORAGE_ACCOUNT_LABEL_ACCESS_KEY=
AZURE_STORAGE_ACCOUNT_FOOD_NAME=
AZURE_STORAGE_ACCOUNT_FOOD_ACCESS_KEY=
```

## Running Locally
Start the server:

```bash
npm start
```

Navigate to http://localhost:3000 and upload an image to blob storage.

