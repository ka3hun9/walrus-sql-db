module walrus_sql::walrus_sql {
    use std::string;
    use std::string::String;
    use sui::event;
    use sui::object::{Self, ID, UID};
    use sui::transfer;
    use sui::tx_context::{Self, TxContext};

    struct Catalog has key {
        id: UID,
        owner: address,
    }

    struct TableMeta has key {
        id: UID,
        name: String,
        schema: String,
        commit_count: u64,
        latest_manifest_hash: String,
        latest_index_root: String,
    }

    struct TableCreated has copy, drop {
        table_id: ID,
    }

    struct CommitWritten has copy, drop {
        table_id: ID,
        op: u8, // 1=insert,2=update,3=delete
        commit_no: u64,
    }

    fun init(ctx: &mut TxContext) {
        let catalog = Catalog {
            id: object::new(ctx),
            owner: tx_context::sender(ctx),
        };
        transfer::share_object(catalog);
    }

    public entry fun create_table(
        _catalog: &mut Catalog,
        name: String,
        schema: String,
        ctx: &mut TxContext,
    ) {
        let table = TableMeta {
            id: object::new(ctx),
            name,
            schema,
            commit_count: 0,
            latest_manifest_hash: string::utf8(b""),
            latest_index_root: string::utf8(b""),
        };

        let table_id = object::id(&table);
        event::emit(TableCreated { table_id });
        transfer::share_object(table);
    }

    public entry fun insert(
        table: &mut TableMeta,
        _row_blob_hash: String,
        manifest_hash: String,
        index_root: String,
    ) {
        table.commit_count = table.commit_count + 1;
        table.latest_manifest_hash = manifest_hash;
        table.latest_index_root = index_root;

        event::emit(CommitWritten {
            table_id: object::id(table),
            op: 1,
            commit_no: table.commit_count,
        });
    }

    public entry fun update(
        table: &mut TableMeta,
        _row_blob_hash: String,
        manifest_hash: String,
        index_root: String,
    ) {
        table.commit_count = table.commit_count + 1;
        table.latest_manifest_hash = manifest_hash;
        table.latest_index_root = index_root;

        event::emit(CommitWritten {
            table_id: object::id(table),
            op: 2,
            commit_no: table.commit_count,
        });
    }

    public entry fun delete(
        table: &mut TableMeta,
        _row_blob_hash: String,
        manifest_hash: String,
        index_root: String,
    ) {
        table.commit_count = table.commit_count + 1;
        table.latest_manifest_hash = manifest_hash;
        table.latest_index_root = index_root;

        event::emit(CommitWritten {
            table_id: object::id(table),
            op: 3,
            commit_no: table.commit_count,
        });
    }
}
