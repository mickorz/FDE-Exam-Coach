import unittest, tempfile, json, subprocess, urllib.request, urllib.error, time, sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import server

class PersistenceTests(unittest.TestCase):
    def test_atomic_round_trip_and_invalid_import(self):
        with tempfile.TemporaryDirectory() as d:
            old=server.STATE_PATH;server.STATE_PATH=Path(d)/'progress.json'
            try:
                state=server.empty_state();state['records']['FDE-stable']={'attempts':[{'answers':['A'],'correct':True,'at':1}],'favorite':True}
                server.save_state(state);self.assertEqual(server.load_state(),state)
                self.assertEqual(list(Path(d).iterdir()),[server.STATE_PATH])
                self.assertRaises(ValueError,server.validate_state,{'schemaVersion':2})
            finally:server.STATE_PATH=old

if __name__=='__main__':unittest.main()
