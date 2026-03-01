# this file helps to create differe colors to label-studion labels
import random
for label in ["cleaning_cart", "person", "mop", "broom", "bucket", "vacuum", "spray_bottle", "trash_bag", "glove", "cleaning_sign", "dustpan", "high_vis_vest", "disinfectant", "rag", "floor_cleaning_machine", "clean_sponge", "trash_bin"]:
    color = "#{:06x}".format(random.randint(0, 0xFFFFFF))
    print(f'<Label value="{label}" background="{color}"/>')
