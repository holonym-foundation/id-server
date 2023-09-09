Backend for Holonym's ID service.

## Requirements

- Node.js ^18.9.0
- Docker ^20.10.18

(Other versions might work too.)

## Local environment setup

### 1. Node.js

Use [nvm](https://github.com/nvm-sh/nvm#about) to use the correct Node version.

1.  Follow the instructions in the [nvm repo](https://github.com/nvm-sh/nvm#about) to install nvm.
2.  Install and use the correct version of Node.

        nvm install

### 2. Install Node dependencies

        npm install

### 3. Environment variables

#### Create .env files

Copy .env.example to .env.

        cp .env.example .env

You also need a .env.docker.dev file.

        cp .env .env.docker.dev

(We use a separate .env.docker.\<ENVIRONMENT> file for every environment we run.)

#### Set environment variables

Go through .env.docker.dev and update the environment variables. Some environment variables are already correctly set in the .env.example file for local development.

### 4. Database setup

This server uses MongoDB. You can run MongoDB in various ways, as long as you are able to access it using a connection string. Once you set up the database, set the `MONGO_DB_CONNECTION_STR` environment variable.

You can run the MongoDB Docker container.

        docker run -d --network host --name id-server-mongo -e MONGO_INITDB_ROOT_USERNAME=admin -e MONGO_INITDB_ROOT_PASSWORD=password mongo

Alternatively, you can setup a MongoDB cluster using MongoDB Atlas. To connect to the cluster in the app, simply ensure that the `MONGO_DB_CONNECTION_STR` variable is set to the connection string provided by Atlas.

## Run

Ensure that the MongoDB database is running and that environment variables are set.

Open a terminal window, navigate to the root directory of this repo, and run:

        npm run start:dev

Note that the daemon can also be run. However, for development, running the daemon is not necessary.

## Test

We use mocha for tests. Run tests with:

        npm test
