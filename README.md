Backend for Holonym's ID service.

## Requirements

- Bun ^1.2.21
- Docker ^20.10.18

(Other versions might work too.)

## Local environment setup

### 1. Bun

Install Bun by following the instructions at [bun.sh](https://bun.sh/docs/installation).

### 2. Install dependencies

        bun install

### 3. Environment variables

#### Create .env files

Copy .env.example to .env.

        cp .env.example .env

You also need a .env.docker.dev file.

        cp .env .env.docker.dev

(We use a separate .env.docker.\<ENVIRONMENT> file for every environment we run.)

#### Set environment variables

Go through .env.docker.dev and update the environment variables. Some environment variables are already correctly set in the .env.example file for local development.

### 4. Datastore setup

**MongoDB**

This server uses MongoDB. You can run MongoDB in various ways, as long as you are able to access it using a connection string. Once you set up the database, set the `MONGO_DB_CONNECTION_STR` environment variable.

You can run the MongoDB Docker container.

        docker run -d --network host --name id-server-mongo -e MONGO_INITDB_ROOT_USERNAME=admin -e MONGO_INITDB_ROOT_PASSWORD=password mongo

Alternatively, you can setup a MongoDB cluster using MongoDB Atlas. To connect to the cluster in the app, simply ensure that the `MONGO_DB_CONNECTION_STR` variable is set to the connection string provided by Atlas.

**DynamoDB**

Option 1, using docker:

```bash
docker run -p 8000:8000 amazon/dynamodb-local
```

After starting DynamoDB Local, create the required tables and indexes by running:

```bash
./scripts/setup-dynamodb-local.sh
```

Option 2, using NoSQL Workbench:

See [NoSQL Workbench](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/workbench.html) to run Dynamo DB locally and use it also as a GUI.

tl;dr: https://youtu.be/Mq3tM8so3xU 

Once you have NoSQL Workbench running, look to the bottom left area and turn on “DDB local” toggle to run a local DynamoDB instance.

For the first time, you need to load the data model `./dynamodb-model.json. From the home screen of NoSQL Workbench, refer to the top right area and click on “Import data model”, import the model JSON file.

Then to get started with tables as defined in the model, go to “Visualizer”, load the model and “Commit to Amazon DynamoDB” and select your local connection.

You can get connection credentials by clicking on the connection’s “⋮” button.

**Setting up AWS.config for local DynamoDB

At the top of `dynamodb.js`, update the line 2 as below

```javascript
AWS.config.update({
    credentials: {
        accessKeyId: "ijpw4p",
        secretAccessKey: "5fhibc",
    },
    region: 'us-east-2'
});

var ddb = new AWS.DynamoDB();
```

**Valkey**

```bash
docker run valkey/valkey
```

## Run

Ensure that the MongoDB database is running and that environment variables are set.

Open a terminal window, navigate to the root directory of this repo, and run:

        bun run start:dev

Note that the daemon can also be run. However, for development, running the daemon is not necessary.

## Test

We use bun's built-in test runner. Run tests with:

        bun test

## Other heplful bits for local development

### Phone verification

**Skipping IP Quality Score check for running locally**
In `check-number.jt`, you can comment out `GET` request to `https://ipqualityscore.com` from ~ line 202 to 206. Then comment out check out `isSafe` from ~ line 228 - 233.

**Skipping OTP sending for running locally**
In `otp.js` ~ line 62, you can comment out `sendOTP` and log `otp` to be entered for verification.

So with all these setup, `.env` is not needed.

```javascript
// await sendOTP(phoneNumber, otp);
console.log("cacheOTP: ", phoneNumber, otp);
```

