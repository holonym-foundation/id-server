use std::env;

use tokio::time::{interval, Duration};
use serde::{Serialize, Deserialize};
use serde_json::Value;
use dotenv::dotenv;

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
    let url = get_id_server_url() + "/admin/transfer-funds";

    let api_key = env::var("ADMIN_API_KEY").expect("ADMIN_API_KEY must be set");

    let client = reqwest::Client::new();
    let req_result = client.post(url).header("x-api-key", api_key).send().await;

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


#[tokio::main]
async fn main() {
    dotenv().ok();

    env::var("ENVIRONMENT").expect("ENVIRONMENT must be set");
    env::var("ADMIN_API_KEY").expect("ADMIN_API_KEY must be set");

    let mut interval = interval(Duration::from_secs(600));
    loop {
        interval.tick().await;
        trigger_deletion_of_user_idv_data().await;
        trigger_transfer_of_funds().await;
    }
}
