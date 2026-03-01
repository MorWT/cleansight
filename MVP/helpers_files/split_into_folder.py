# This file divide one folder that include large amount of images into sub-folder of images
import os
import shutil
from math import ceil

def split_folder_into_chunks(src_folder: str, chunk_size: int = 100):
    """
    Split all files in a source folder into subfolders, each containing up to `chunk_size` files.

    Parameters
    ----------
    src_folder : str
        Path to the source folder containing files.
    chunk_size : int, optional
        Number of files per subfolder (default is 100).
    """
    if not os.path.isdir(src_folder):
        raise NotADirectoryError(f"❌ The provided path '{src_folder}' is not a valid directory.")

    # List all files in the folder
    files = [f for f in os.listdir(src_folder) if os.path.isfile(os.path.join(src_folder, f))]
    total_files = len(files)

    if total_files == 0:
        print("⚠️ No files found in the provided folder.")
        return

    # Calculate number of chunks
    num_chunks = ceil(total_files / chunk_size)

    print(f"📂 Found {total_files} files in '{src_folder}'. Splitting into {num_chunks} subfolders...")

    for i in range(num_chunks):
        # Create subfolder
        subfolder_name = f"part_{i+1:03d}"
        subfolder_path = os.path.join(src_folder, subfolder_name)
        os.makedirs(subfolder_path, exist_ok=True)

        # Move the files
        start_idx = i * chunk_size
        end_idx = start_idx + chunk_size
        for filename in files[start_idx:end_idx]:
            shutil.move(os.path.join(src_folder, filename), os.path.join(subfolder_path, filename))

        print(f"✅ Created '{subfolder_name}' with files {start_idx+1}–{min(end_idx, total_files)}")

    print("🎉 Done! Folder successfully split.")

# Example usage
if __name__ == "__main__":
    folder_path = "dataset/cleaning/copy_images"
    split_folder_into_chunks(folder_path, chunk_size=100)
