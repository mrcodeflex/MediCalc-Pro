
import 'package:sqflite/sqflite.dart';
import 'package:path/path.dart';
class DbService {
  static Database? _db;
  static Future<Database> getDb() async {
    if (_db != null) return _db!;
    final databasesPath = await getDatabasesPath();
    final path = join(databasesPath, 'medi_calc_pro.db');
    _db = await openDatabase(path, version: 1, onCreate: (db, version) async {
      await db.execute('CREATE TABLE IF NOT EXISTS calculators(id TEXT PRIMARY KEY, name TEXT, category TEXT, description TEXT, formula TEXT, fields TEXT, isPremium INTEGER, createdAt TEXT)');
      await db.execute('CREATE TABLE IF NOT EXISTS subscriptions(code TEXT PRIMARY KEY, type TEXT, expiresAt TEXT, activated INTEGER)');
    });
    return _db!;
  }
}
