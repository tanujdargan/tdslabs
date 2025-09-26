### Improving Ubuntu Remote Desktop Access (for Unattended Setups)

Ubuntu’s built-in RDP support can be unreliable, especially for unattended remote access. Follow these steps to set up a more stable RDP connection using **xrdp** and **XFCE**:

#### 1. Install XRDP

```bash
sudo apt update
sudo apt install xrdp
```

#### 2. Enable and Start the XRDP Service

```bash
sudo systemctl enable xrdp
sudo systemctl start xrdp
```

#### 3. Configure XRDP to Use XFCE

Create or edit the `~/.xsession` file with the following content:

```echo "/usr/bin/dbus-launch --exit-with-session xfce4-session" > ~/.xsession```

#### 4. (Optional but Recommended) Install SSH for Terminal Access

```bash
sudo apt install openssh-server
sudo systemctl enable ssh
sudo systemctl start ssh
sudo systemctl status ssh
```

#### 5. Reboot the System

```bash
sudo reboot
```

#### 6. Connect Remotely

* Use the PC’s IP address to connect.
* Use **Windows Remote Desktop** or any RDP-compatible client.
* Login with your Ubuntu username and password.
