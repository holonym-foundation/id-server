use std::{env, process::Command};

use tokio::time::{interval, Duration};
use serde::{Serialize, Deserialize};
use serde_json::Value;
use dotenv::dotenv;
use std::process::Stdio;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Serialize, Deserialize, Debug)]
struct DeleteUserDataResponse {
    message: Option<String>,
    error: Option<String>,
}

#[derive(Serialize, Deserialize, Debug)]
struct TransferFundsResponse {
    optimism: Option<Value>,
    fantom: Option<Value>,
    avalanche: Option<Value>,
    error: Option<String>,
}

fn get_hours_since_epoch() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() / 3600  // Convert seconds to hours
}

fn get_id_server_url() -> String {
    let environment = env::var("ENVIRONMENT").expect("ENVIRONMENT must be set");
    
    let id_server_url = if environment == "dev" {
        "http://localhost:3000"
    } else {
        "https://id-server.holonym.io"
    };
    id_server_url.to_owned()
}

async fn trigger_deletion_of_user_idv_data() {
    let url = get_id_server_url() + "/admin/user-idv-data";

    let api_key = env::var("ADMIN_API_KEY").expect("ADMIN_API_KEY must be set");

    let client = reqwest::Client::new();
    let req_result = client.delete(url).header("x-api-key", api_key).send().await;

    match req_result {
        Ok(resp) => {
            let status = resp.status();
            let json_result = resp.json::<DeleteUserDataResponse>().await;

            match json_result {
                Ok(json) => {
                    if status != 200 {
                        println!("Error triggering deletion of user data from IDV provider databases. response status: {:?}. response: {:?}", status, json);
                    } else {
                        println!("Successfully triggered deletion of user data from IDV provider databases. response status: {:?}. response: {:?}", status, json);
                    }
                },
                Err(e) => println!("Error parsing response json: {:?}", e),
            }
        },
        Err(e) => println!("Error triggering deletion of user data from IDV provider databases: {:?}", e),
    }
}

async fn trigger_transfer_of_funds() {
    println!("trigger_transfer_of_funds ---- starting");
    let url = get_id_server_url() + "/admin/transfer-funds";

    let api_key = env::var("ADMIN_API_KEY").expect("ADMIN_API_KEY must be set");

    let client = reqwest::Client::new();
    let req_result = client.post(url).header("x-api-key", api_key).send().await;

    println!("trigger_transfer_of_funds ---- got response");

    match req_result {
        Ok(resp) => {
            let status = resp.status();
            let json_result = resp.json::<TransferFundsResponse>().await;

            match json_result {
                Ok(json) => {
                    if status != 200 {
                        println!("Error triggering transfer of funds. response status: {:?}. response: {:?}", status, json);
                    } else {
                        println!("Successfully triggered transfer of funds. response status: {:?}. response: {:?}", status, json);
                    }
                },
                Err(e) => println!("Error parsing response json: {:?}", e),
            }
        },
        Err(e) => println!("Error triggering transfer of funds: {:?}", e),
    }
}

async fn run_transaction_scanner() {
    let path_to_js = env::var("PATH_TO_TRANSACTION_SCANNER_DIR").expect("PATH_TO_TRANSACTION_SCANNER_DIR must be set");
    
    let mut child = Command::new("node")
        .arg(path_to_js + "/dist/index.js")
        .arg("id-and-phone")
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .spawn()
        .unwrap();

    let status = child.wait();
    println!("Transaction scanner exited with status {:?}", status);
}


#[tokio::main]
async fn main() {
    dotenv().ok();

    env::var("ENVIRONMENT").expect("ENVIRONMENT must be set");
    env::var("ADMIN_API_KEY").expect("ADMIN_API_KEY must be set");
    env::var("PATH_TO_TRANSACTION_SCANNER_DIR").expect("PATH_TO_TRANSACTION_SCANNER_DIR must be set");

    let started_at_hour = get_hours_since_epoch();

    let mut interval = interval(Duration::from_secs(600));
    loop {
        interval.tick().await;
        trigger_deletion_of_user_idv_data().await;
        trigger_transfer_of_funds().await;

        // Run the transaction scanner every 3 hours
        // let current_hour = get_hours_since_epoch();
        // if (current_hour - started_at_hour) % 3 == 0 {
        //     println!("Running transaction scanner");
        //     tokio::spawn(async {
        //         run_transaction_scanner().await;
        //     });
        // }
    }
}
