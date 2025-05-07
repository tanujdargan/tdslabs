SuggestArr Installation:

apt update
apt install curl python3 python3-pip nodejs npm -y
git clone https://github.com/giuseppe99barchetta/SuggestArr.git
cd SuggestArr
apt install python3.11-venv -y
python3 -m venv venv
source venv/bin/activate
cd api_service
pip install -r requirements.txt
cd .. && cd client
npm install
cd api_service
source venv/bin/activate - if necessary
python -m flask run --host=0.0.0.0 --port=5000


To create a service:
nano /etc/systemd/system/suggestarr.service

```bash
[Unit]
Description=SuggestArr
After=network.target

[Service]
User=root
WorkingDirectory=/home/SuggestArr/api_service   
ExecStart=/home/SuggestArr/venv/bin/python -m flask run --host=0.0.0.0 --port=5000
Environment="FLASK_APP=app.py"
Environment="FLASK_DEBUG=0"
Restart=always

[Install]
WantedBy=multi-user.target

```

sudo systemctl daemon-reload
sudo systemctl start suggestarr.service
sudo systemctl enable suggestarr.service

cd ../ && cd client
npm run serve

served at: http://10.0.0.195:8080/