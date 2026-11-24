import unittest
from contract import validate_request
class ContractTests(unittest.TestCase):
    def test_valid(self):
        self.assertEqual(validate_request("  sunset  ",1024,576),("sunset",1024,576))
    def test_short_prompt(self):
        with self.assertRaises(ValueError):validate_request("no",1024,576)
    def test_reject_oversized(self):
        with self.assertRaises(ValueError):validate_request("hello world",4096,4096)
    def test_reject_boolean_dimensions(self):
        with self.assertRaises(ValueError):validate_request("hello world",True,576)
