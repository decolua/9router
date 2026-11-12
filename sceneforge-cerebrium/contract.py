"""CPU-only request validation for SceneForge GPU image generation."""
def validate_request(prompt:object,width:object,height:object)->tuple[str,int,int]:
    if not isinstance(prompt,str) or not 4<=len(prompt.strip())<=400:
        raise ValueError("Prompt must contain 4 to 400 characters.")
    if type(width) is not int or type(height) is not int:
        raise ValueError("Width and height must be integers.")
    if (width,height) not in {(1024,576),(768,768),(576,1024)}:
        raise ValueError("Supported sizes: 1024x576, 768x768, 576x1024.")
    return prompt.strip(),width,height
