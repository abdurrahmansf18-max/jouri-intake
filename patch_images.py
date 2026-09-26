import sys

content = open("api/product_image_routes.py").read()

if "jouri_edit_unlock: Annotated[str | None, Cookie()] = None," not in content.split("def add_product_images")[1].split(":")[0]:
    # Need to add it.
    pass
