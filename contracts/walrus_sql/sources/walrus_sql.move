module walrus_sql::walrus_sql {
    use std::string::String;
    use sui::event;
    use sui::object::{Self, ID, UID};
    use sui::tx_context::{Self, TxContext};
    use sui::transfer;

    public struct Catalog has key {
        id: UID,
        owner: address,
    }

    public struct TableMeta has key {
        id: UID,
        name: String,
        schema: String,
        commit_count: u64,
        latest_manifest_hash: String,
        latest_index_root: String,
    }

    public struct TableCreated has copy, drop {
        table_id: ID,
    }

    public struct CommitWritten has copy, drop {
        table_id: ID,
        op: u8, // 1=insert,2=update,3=delete
        commit_no: u64,
        manifest_hash: String,
        index_root: String,
        row_blob_hash: String,
    }

    entry fun init(ctx: &mut TxContext) {
        let catalog = Catalog {
            id: object::new(ctx),
            owner: tx_context::sender(ctx),
        };
        transfer::share_object(catalog);
    }

    entry fun create_table(
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
            latest_manifest_hash: b"".to_string(),
            latest_index_root: b"".to_string(),
        };

        let table_id = object::id(&table);

        event::emit(TableCreated {
            table_id,
        });

        transfer::share_object(table);
    }

    entry fun insert(
        table: &mut TableMeta,
        row_blob_hash: String,
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
            manifest_hash: table.latest_manifest_hash,
            index_root: table.latest_index_root,
            row_blob_hash,
        });
    }

    entry fun update(
        table: &mut TableMeta,
        row_blob_hash: String,
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
            manifest_hash: table.latest_manifest_hash,
            index_root: table.latest_index_root,
            row_blob_hash,
        });
    }

    entry fun delete(
        table: &mut TableMeta,
        row_blob_hash: String,
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
            manifest_hash: table.latest_manifest_hash,
            index_root: table.latest_index_root,
            row_blob_hash,
        });
    }
}