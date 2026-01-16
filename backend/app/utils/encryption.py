from cryptography.fernet import Fernet

def generate_key():
    return Fernet.generate_key()

def encrypt_message(message: str, key: bytes) -> bytes:
    f = Fernet(key)
    return f.encrypt(message.encode())

def decrypt_message(encrypted_message: bytes, key: bytes) -> str:
    f = Fernet(key)
    return f.decrypt(encrypted_message).decode()
